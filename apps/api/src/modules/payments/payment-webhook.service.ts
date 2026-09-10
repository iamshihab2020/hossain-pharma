import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { type Transaction, schema, withTenant } from '@nexmarket/db';
import { captureEntries, money } from '@nexmarket/shared';
import { LedgerService } from '../ledger/ledger.service.js';
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
  type WebhookEvent,
} from './payment-provider.port.js';

export type WebhookOutcome = { applied: boolean; reason: string };

/**
 * THE ONLY WRITER of `payment_intents.status`, and PRD 11 Phase 4 makes that a
 * blocking acceptance criterion rather than a preference.
 *
 * `POST /checkout/confirm` creates an intent and leaves it at REQUIRES_PAYMENT
 * or COD_PENDING even when the adapter could have settled synchronously. Order
 * status never derives from a gateway response read by the browser (PRD 10.1) -
 * it derives from a signed message the gateway sent this server.
 *
 * Everything here is idempotent by CONSTRAINT rather than by lookup. Gateways
 * retry; two deliveries of one event arriving concurrently would both pass a
 * prior `SELECT ... WHERE provider_event_id = $1` and both post a capture. The
 * unique index on `(provider, provider_event_id)` is what makes the second one
 * lose.
 */
@Injectable()
export class PaymentWebhookService {
  private readonly log = new Logger(PaymentWebhookService.name);

  constructor(
    private readonly ledger: LedgerService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProvider[],
  ) {}

  /**
   * Verifies, deduplicates and applies one delivered webhook.
   *
   * Returns rather than throws for an already-applied event: a gateway reads a
   * non-2xx as "retry", so answering 500 to a duplicate is how a retry storm
   * starts.
   */
  async handle(
    providerName: string,
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<WebhookOutcome> {
    const provider = this.providers.find((p) => p.method === providerName);
    if (provider === undefined) throw new NotFoundException('Unknown payment provider');

    const event = provider.verifyWebhook(rawBody, headers);
    // One answer for a forged signature, a malformed body and an unknown event
    // type. Distinguishing them tells an attacker which half to fix.
    if (event === null) return { applied: false, reason: 'invalid signature or payload' };

    /**
     * THE WEBHOOK RUNS AS THE PLATFORM, and unlike checkout that is the right
     * call rather than a shortcut.
     *
     * It has no user and no tenant: a gateway holds no NexMarket session. It
     * must read every order attached to one intent - which spans several
     * sellers by construction - and move each to PAID. With no tenant and no
     * user, `tenant_isolation` and `own_orders` both match nothing, so it would
     * read zero orders and capture nothing, silently.
     *
     * The difference from checkout is who is driving. Checkout is a buyer's
     * request, so running it with the admin bypass would hand a buyer's
     * transaction every tenant's rows. This is server-to-server, authenticated
     * by an HMAC over the body, and the only caller-influenced value that
     * reaches a query is `providerRef` - which selects one intent and nothing
     * else. `platform_admin_bypass` is exactly the policy for a platform actor.
     */
    return withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
      const fresh = await this.recordEvent(tx, providerName, event);
      if (!fresh) return { applied: false, reason: 'already applied' };

      const intent = await this.intentFor(tx, event.providerRef);
      if (intent === null) return { applied: false, reason: 'no such payment intent' };

      // A terminal intent stays terminal. A `payment_failed` arriving after a
      // `payment_succeeded` is a gateway reordering its own retries, not an
      // instruction to un-capture money.
      if (intent.status === 'SUCCEEDED' || intent.status === 'FAILED') {
        return { applied: false, reason: `intent already ${intent.status}` };
      }

      if (event.type === 'payment_succeeded') {
        await this.capture(tx, intent);
        return { applied: true, reason: 'captured' };
      }

      await this.fail(tx, intent);
      return { applied: true, reason: 'failed' };
    });
  }

  /**
   * Inserts the event, returning false if it was already there.
   *
   * INSERT ... ON CONFLICT DO NOTHING, and the row count is the answer. This is
   * the whole of the idempotency guarantee.
   */
  private async recordEvent(
    tx: Transaction,
    providerName: string,
    event: WebhookEvent,
  ): Promise<boolean> {
    const inserted = await tx.execute(sql`
      INSERT INTO payment_events (provider, provider_event_id, type)
      VALUES (${providerName}, ${event.providerEventId}, ${event.type})
      ON CONFLICT (provider, provider_event_id) DO NOTHING
      RETURNING id
    `);
    return (inserted.rowCount ?? 0) > 0;
  }

  private async intentFor(
    tx: Transaction,
    providerRef: string,
  ): Promise<typeof schema.paymentIntents.$inferSelect | null> {
    const rows = await tx
      .select()
      .from(schema.paymentIntents)
      .where(eq(schema.paymentIntents.providerRef, providerRef))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Money arrived: post the capture and move every order to PAID.
   *
   * The ledger entries are built by `captureEntries` in @nexmarket/shared - the
   * same function the unit tests cover to 100% against the PRD 10.1 worked
   * example. Building them here instead would be a second definition of what a
   * capture means.
   */
  private async capture(
    tx: Transaction,
    intent: typeof schema.paymentIntents.$inferSelect,
  ): Promise<void> {
    const orders = await tx
      .select({
        id: schema.orders.id,
        tenantId: schema.orders.tenantId,
        total: schema.orders.totalAmount,
        commission: schema.orders.commissionAmount,
      })
      .from(schema.orders)
      .where(eq(schema.orders.paymentIntentId, intent.id));

    if (orders.length === 0) {
      // An intent with no orders cannot be captured into anything. Better a
      // loud log and no ledger entries than a balanced transaction nobody owns.
      this.log.error(`Payment intent ${intent.id} succeeded with no orders attached`);
      return;
    }

    // One capture posts ONE pair of entries: the buyer owes, and the money
    // lands in clearing. Attributing it to sellers is dispatch's job now - see
    // releaseEntries - because a seller who has not shipped is not owed.
    const total = orders.reduce((sum, order) => sum + order.total, 0);

    await this.ledger.post(tx, {
      paymentIntentId: intent.id,
      kind: 'CAPTURE',
      entries: captureEntries(money(total, intent.currency)),
    });

    await tx
      .update(schema.paymentIntents)
      .set({ status: 'SUCCEEDED', updatedAt: new Date() })
      .where(eq(schema.paymentIntents.id, intent.id));

    await tx
      .update(schema.orders)
      .set({ status: 'PAID', updatedAt: new Date() })
      .where(eq(schema.orders.paymentIntentId, intent.id));
  }

  /**
   * Payment failed: release the stock and cancel the orders.
   *
   * Releasing the reservation matters more than the status does. Stock reserved
   * against a payment that never arrives is stock nobody can buy, and nothing
   * else in the system would ever give it back.
   */
  private async fail(
    tx: Transaction,
    intent: typeof schema.paymentIntents.$inferSelect,
  ): Promise<void> {
    const orders = await tx
      .select({ id: schema.orders.id, tenantId: schema.orders.tenantId })
      .from(schema.orders)
      .where(eq(schema.orders.paymentIntentId, intent.id));

    for (const order of orders) {
      // GREATEST(..., 0) rather than a bare subtraction: a release that ran
      // twice would drive `reserved` negative, and the CHECK constraint would
      // turn a duplicate webhook into a 500 instead of a no-op.
      await tx.execute(sql`
        UPDATE inventory_items ii
           SET reserved = GREATEST(ii.reserved - oi.quantity, 0), updated_at = now()
          FROM order_items oi
         WHERE oi.order_id = ${order.id} AND ii.listing_id = oi.listing_id
      `);
    }

    await tx
      .update(schema.orders)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(eq(schema.orders.paymentIntentId, intent.id));

    await tx
      .update(schema.paymentIntents)
      .set({ status: 'FAILED', updatedAt: new Date() })
      .where(eq(schema.paymentIntents.id, intent.id));
  }
}
