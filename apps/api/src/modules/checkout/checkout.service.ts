import { BadRequestException, ConflictException, Injectable, Inject } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { type Transaction, schema, withTenant } from '@nexmarket/db';
import { type Entry, money } from '@nexmarket/shared';
import { asTenantScope } from '../../common/tenant-scope.js';
import { OrderEventsService } from '../fulfilment/order-events.service.js';
import { AddressesService } from '../addresses/addresses.service.js';
import { CartService } from '../cart/cart.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ListingsService } from '../listings/listings.service.js';
import { SearchIndexService } from '../search/search-index.service.js';
import {
  PAYMENT_PROVIDERS,
  type PaymentMethod,
  type PaymentProvider,
} from '../payments/payment-provider.port.js';
import { QuoteService, type Quote } from './quote.service.js';
import type { ConfirmInput } from './dto.js';

export type PlacedOrder = {
  id: string;
  orderNumber: string;
  sellerId: string;
  sellerName: string;
  total: { amount: number; currency: string };
};

export type Confirmation = {
  paymentIntentId: string;
  status: string;
  method: PaymentMethod;
  clientSecret: string | null;
  orders: PlacedOrder[];
  total: { amount: number; currency: string };
};

/** PRD 9.1's age gate: a date-of-birth confirmation, nothing heavier. */
const MINIMUM_AGE_YEARS = 18;

@Injectable()
export class CheckoutService {
  constructor(
    private readonly quotes: QuoteService,
    private readonly cart: CartService,
    private readonly addresses: AddressesService,
    private readonly ledger: LedgerService,
    private readonly listings: ListingsService,
    private readonly searchIndex: SearchIndexService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProvider[],
    private readonly events: OrderEventsService,
  ) {}

  /** The priced cart, for display. Same code path the confirm uses. */
  async quote(userId: string, addressId: string): Promise<Quote> {
    const address = await this.addresses.forCheckout(addressId);
    return this.run(userId, async (tx) => {
      const cartId = await this.cart.cartFor(tx, { userId });
      return this.quotes.quote(tx, cartId, address);
    });
  }

  /**
   * Places the orders.
   *
   * Everything below happens in ONE transaction, in this order, and the order
   * matters:
   *
   *   1. quote        - prices read from the database, never from the request
   *   2. compare      - the caller's expectedTotal is checked, not used
   *   3. reserve      - a conditional UPDATE, so overselling is impossible
   *   4. intent       - created REQUIRES_PAYMENT or COD_PENDING, never settled
   *   5. orders       - one per seller, with prices SNAPSHOTTED
   *   6. ledger       - balanced, or the whole transaction rolls back
   *   7. stock + index - through the single writer, then reindex
   *
   * If any step throws, none of it happened. An order without ledger entries,
   * or stock reserved for an order that was never placed, are both states no
   * amount of later reconciliation can clean up honestly.
   */
  async confirm(userId: string, input: ConfirmInput): Promise<Confirmation> {
    const address = await this.addresses.forCheckout(input.addressId);
    const provider = this.providerFor(input.paymentMethod);

    return this.run(userId, async (tx) => {
      // Idempotency is a UNIQUE CONSTRAINT, not a prior lookup: two concurrent
      // submissions of the same key would both find nothing and both place
      // orders. The existing-intent check here is the fast path; the constraint
      // is what actually holds.
      const existing = await this.findByIdempotencyKey(tx, input.idempotencyKey, userId);
      if (existing !== null) return existing;

      const cartId = await this.cart.cartFor(tx, { userId });
      const quote = await this.quotes.quote(tx, cartId, address);

      this.assertTotalMatches(quote, input);
      this.assertAgeGate(quote, input);

      const [intent] = await tx
        .insert(schema.paymentIntents)
        .values({
          buyerUserId: userId,
          provider: provider.method,
          amountTotal: quote.total.amount,
          currency: quote.currency,
          idempotencyKey: input.idempotencyKey,
        })
        .returning({ id: schema.paymentIntents.id });
      if (intent === undefined) throw new Error('Payment intent insert returned no row');

      const created = await provider.createIntent({
        intentId: intent.id,
        amount: quote.total,
        buyerUserId: userId,
      });

      await tx
        .update(schema.paymentIntents)
        .set({
          providerRef: created.providerRef,
          status: created.initialStatus,
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentIntents.id, intent.id));

      const orders = await this.placeOrders(tx, {
        quote,
        userId,
        intentId: intent.id,
        address,
        ageVerified: quote.requiresAgeCheck,
      });

      await this.postPlacementEntries(tx, quote, intent.id, provider.method);

      await this.cart.markConverted(tx, cartId);

      return {
        paymentIntentId: intent.id,
        status: created.initialStatus,
        method: provider.method,
        clientSecret: created.clientSecret,
        orders,
        total: quote.total,
      };
    });
  }

  // ---------------------------------------------------------------- internals

  /**
   * PRD 11 Phase 4: "Price tampering rejected."
   *
   * `expectedTotal` is COMPARED, never used. A mismatch is 409 rather than 400
   * because the common cause is a seller repricing mid-checkout, and the
   * client's correct response is to re-render the quote, not to retry.
   */
  private assertTotalMatches(quote: Quote, input: ConfirmInput): void {
    if (
      input.expectedTotal.amount !== quote.total.amount ||
      input.expectedTotal.currency !== quote.currency
    ) {
      throw new ConflictException({
        message: 'Prices changed while you were checking out',
        code: 'PRICE_CHANGED',
        expected: input.expectedTotal,
        actual: quote.total,
      });
    }
  }

  /**
   * PRD 9.1: an age gate if any item is in a RESTRICTED category.
   *
   * The date of birth is checked and DISCARDED - only `age_verified_at` is
   * stored. PRD 13 minimises PII, and a birth date retained to prove an 18+
   * check is more data than the check needs.
   */
  private assertAgeGate(quote: Quote, input: ConfirmInput): void {
    if (!quote.requiresAgeCheck) return;
    if (input.dateOfBirth === undefined) {
      throw new BadRequestException({
        message: 'This order contains age-restricted items',
        code: 'AGE_CHECK_REQUIRED',
      });
    }
    if (ageOn(input.dateOfBirth) < MINIMUM_AGE_YEARS) {
      throw new ConflictException({
        message: `You must be ${MINIMUM_AGE_YEARS} or older to buy these items`,
        code: 'AGE_CHECK_FAILED',
      });
    }
  }

  /**
   * PRD 13's "optimistic locking on inventory", in its cheapest correct form.
   *
   * The check and the write are ONE statement, so no lost update is possible
   * and two concurrent checkouts for the last unit cannot both succeed. A
   * `SELECT ... FOR UPDATE` would serialise every checkout on a popular listing
   * for the length of the whole transaction.
   *
   * Zero rows updated means insufficient stock. The CHECK constraint
   * `reserved <= on_hand` from migration 0008 is the backstop underneath, and
   * it earned its place: the first version of this statement put the capacity
   * test ONLY in the subquery, and two concurrent checkouts both took the last
   * unit.
   *
   * WHY. Postgres evaluates the subquery against the pre-lock snapshot. The
   * second transaction blocks on the row, and when it resumes it re-checks only
   * the OUTER `WHERE` - which said nothing but `id = ...`, still true. So the
   * update applied to a row that no longer had the stock. `FOR UPDATE` makes
   * the subquery take the lock, and repeating the predicate outside is what
   * gets re-evaluated afterwards. Both halves are load-bearing.
   */
  private async reserve(
    tx: Transaction,
    listingId: string,
    quantity: number,
    productName: string,
  ): Promise<void> {
    const updated = await tx.execute(sql`
      UPDATE inventory_items
         SET reserved = reserved + ${quantity}, updated_at = now()
       WHERE id = (
         SELECT id FROM inventory_items
          WHERE listing_id = ${listingId} AND (on_hand - reserved) >= ${quantity}
          ORDER BY (on_hand - reserved) DESC
          LIMIT 1
          FOR UPDATE
       )
         AND (on_hand - reserved) >= ${quantity}
      RETURNING id
    `);
    if ((updated.rowCount ?? 0) === 0) {
      throw new ConflictException(`${productName} sold out while you were checking out`);
    }
  }

  private async placeOrders(
    tx: Transaction,
    input: {
      quote: Quote;
      userId: string;
      intentId: string;
      address: Awaited<ReturnType<AddressesService['forCheckout']>>;
      ageVerified: boolean;
    },
  ): Promise<PlacedOrder[]> {
    const placed: PlacedOrder[] = [];

    for (const group of input.quote.groups) {
      // THE THIRD PLACE THE TENANT GUC MOVES OUTSIDE withTenant, and the reason
      // it had to be added is worth stating rather than burying.
      //
      // `orders`, `order_items`, `inventory_items` and `listings` are all
      // tenant-owned. A buyer checking out writes to FOUR of them across
      // SEVERAL sellers in one transaction, and a buyer is not any of those
      // tenants. There were three ways to make that work:
      //
      //   - run the whole checkout as a platform admin, which hands a buyer's
      //     transaction read and write access to every table in the system to
      //     solve a narrow write problem;
      //   - add a buyer-insert policy on `orders`, which would let a buyer
      //     forge an order attributed to themselves against any seller - an
      //     order row is what a seller's fulfilment queue reads, so that is a
      //     way to make a stranger ship goods;
      //   - switch into ONE seller's scope for exactly their writes.
      //
      // The third is the narrowest and is what `asTenantScope` was built for.
      // The safety rule in tenant-scope.ts holds: `group.sellerId` is
      // `listings.tenant_id`, read from the database inside this transaction -
      // the buyer chose a listing, never a tenant, so no caller-supplied value
      // reaches this call.
      const order = await asTenantScope(tx, group.sellerId, async () => {
        const inserted = await this.writeOrder(tx, group, input);
        // The first entry on the buyer's timeline. Recorded here rather than
        // left for the first seller action, so an order that nobody has touched
        // still has a history rather than an empty panel.
        await this.events.record(
          tx,
          { id: inserted.id, tenantId: group.sellerId, buyerUserId: input.userId },
          { type: 'PLACED', actor: 'BUYER', actorUserId: input.userId },
        );
        // Reserving stock and recomputing the summary belong in the SAME scope:
        // both tables are this seller's, and doing them outside it would fail
        // the tenant policy rather than silently succeed.
        for (const line of group.lines) {
          await this.reserve(tx, line.listingId, line.quantity, line.productName);
        }
        // F-2 from the plan's audit: a write that changes what a buyer would
        // FIND must reindex, and taking the last unit does exactly that -
        // `in_stock`, `min_price_amount` and `seller_count` all derive from
        // ELIGIBLE offers. The recompute goes through ListingsService because
        // that class is the single documented writer of
        // `listings.available_stock`; a second writer here would drift from it.
        for (const line of group.lines) {
          await this.listings.recomputeAvailableStock(tx, line.listingId);
          await this.searchIndex.reindexForListing(tx, line.listingId);
        }
        return inserted;
      });

      placed.push({
        id: order.id,
        orderNumber: order.orderNumber,
        sellerId: group.sellerId,
        sellerName: group.sellerName,
        total: group.total,
      });
    }

    return placed;
  }

  /** One seller's order and its items. Runs inside that seller's tenant scope. */
  private async writeOrder(
    tx: Transaction,
    group: Quote['groups'][number],
    input: {
      quote: Quote;
      userId: string;
      intentId: string;
      address: Awaited<ReturnType<AddressesService['forCheckout']>>;
      ageVerified: boolean;
    },
  ): Promise<{ id: string; orderNumber: string }> {
    {
      const [order] = await tx
        .insert(schema.orders)
        .values({
          tenantId: group.sellerId,
          buyerUserId: input.userId,
          paymentIntentId: input.intentId,
          orderNumber: orderNumber(),
          status: 'PENDING_PAYMENT',
          subtotalAmount: group.subtotal.amount,
          shippingAmount: group.shipping.amount,
          taxAmount: group.tax.amount,
          commissionAmount: group.commission.amount,
          totalAmount: group.total.amount,
          currency: input.quote.currency,
          // A SNAPSHOT, not a foreign key: an address edited next year must not
          // restate where last year's parcel went.
          shippingAddress: input.address,
          ageVerifiedAt: input.ageVerified ? new Date() : null,
        })
        .returning({ id: schema.orders.id, orderNumber: schema.orders.orderNumber });
      if (order === undefined) throw new Error('Order insert returned no row');

      for (const line of group.lines) {
        await tx.insert(schema.orderItems).values({
          tenantId: group.sellerId,
          orderId: order.id,
          listingId: line.listingId,
          // Snapshots. The listing may be repriced, renamed or archived
          // tomorrow; an order rendering "unknown product" is a support ticket
          // and one whose total follows today's price is a dispute.
          productName: line.productName,
          variantSku: line.variantSku,
          unitPriceAmount: line.unitPrice.amount,
          quantity: line.quantity,
          lineTotalAmount: line.lineTotal.amount,
          commissionBps: line.commissionBps,
          commissionAmount: line.commission.amount,
          currency: input.quote.currency,
        });
      }

      return order;
    }
  }

  /**
   * What placement posts, and what it deliberately does not.
   *
   * A CARD order posts nothing at placement: no money has moved, and a ledger
   * that recorded intent would overstate receivables for every abandoned
   * checkout. The capture entries are posted by the webhook.
   *
   * A COD order posts at placement, against COD_RECEIVABLE, because the
   * obligation is real the moment the parcel is dispatched even though the cash
   * is days away. That gap is the thing the ledger exists to make visible
   * (PRD 10.1), and Phase 6 clears it on collection.
   */
  private async postPlacementEntries(
    tx: Transaction,
    quote: Quote,
    intentId: string,
    method: PaymentMethod,
  ): Promise<void> {
    if (method !== 'cod') return;

    const entries: Entry[] = [
      { kind: 'COD_RECEIVABLE', ownerOrgId: null, amount: quote.total },
      { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: money(-quote.total.amount, quote.currency) },
    ];
    await this.ledger.post(tx, { paymentIntentId: intentId, kind: 'COD_ACCRUAL', entries });
  }

  private async findByIdempotencyKey(
    tx: Transaction,
    key: string,
    userId: string,
  ): Promise<Confirmation | null> {
    const rows = await tx
      .select()
      .from(schema.paymentIntents)
      .where(eq(schema.paymentIntents.idempotencyKey, key))
      .limit(1);
    const intent = rows[0];
    if (intent === undefined) return null;
    // A key belonging to someone else is not a replay, it is a collision, and
    // returning another buyer's orders would be the worst possible answer.
    if (intent.buyerUserId !== userId) {
      throw new ConflictException('That idempotency key is already in use');
    }

    const orders = await tx.execute<{
      id: string;
      order_number: string;
      tenant_id: string;
      display_name: string;
      total_amount: string | number;
      currency: string;
    }>(sql`
      SELECT o.id, o.order_number, o.tenant_id, g.display_name, o.total_amount, o.currency
        FROM orders o JOIN organisations g ON g.id = o.tenant_id
       WHERE o.payment_intent_id = ${intent.id}
       ORDER BY g.display_name
    `);

    return {
      paymentIntentId: intent.id,
      status: intent.status,
      method: intent.provider as PaymentMethod,
      // Never replayed: a client secret is a credential and this response may
      // be produced long after the original checkout.
      clientSecret: null,
      orders: orders.rows.map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        sellerId: row.tenant_id,
        sellerName: row.display_name,
        total: {
          amount:
            typeof row.total_amount === 'string'
              ? Number.parseInt(row.total_amount, 10)
              : row.total_amount,
          currency: row.currency,
        },
      })),
      total: { amount: intent.amountTotal, currency: intent.currency },
    };
  }

  private providerFor(method: PaymentMethod): PaymentProvider {
    const provider = this.providers.find((p) => p.method === method);
    if (provider === undefined) {
      throw new BadRequestException(`Unsupported payment method: ${method}`);
    }
    return provider;
  }

  /**
   * Checkout runs with NO tenant selected, the buyer in `app.user_id`, and
   * **not** as an admin.
   *
   * Reads work in that context because the catalogue is platform-owned and
   * `public_active_offers` exposes exactly the offers a buyer may purchase.
   * Writes to a seller's tables do not, and are handled one seller at a time in
   * `placeOrders` - see the note there. Running the whole checkout with
   * `isAdmin: true` would have been one character's difference and would have
   * given every buyer's transaction unrestricted read access to every tenant's
   * rows for the duration.
   */
  private run<T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant({ tenantId: null, userId, isAdmin: false }, fn);
  }
}

/** Human-facing and per seller. PRD 9.1: "per-seller order numbers". */
function orderNumber(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const noise = Math.floor(Math.random() * 46_656)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0');
  return `NM-${stamp}-${noise}`;
}

function ageOn(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const month = now.getUTCMonth() - dob.getUTCMonth();
  // A birthday later this year has not happened yet, so the year count is one
  // too high until it does.
  if (month < 0 || (month === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}
