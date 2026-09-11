import { BadRequestException, ConflictException, Injectable, Inject } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { type Transaction, schema, withTenant } from '@nexmarket/db';
import { type Entry, money } from '@nexmarket/shared';
import { asTenantScope } from '../../common/tenant-scope.js';
import { OrderEventsService } from '../fulfilment/order-events.service.js';
import { SlotsService } from '../shipping/slots.service.js';
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

/**
 * How many times one line may re-pick a warehouse before giving up.
 *
 * Generous relative to any real seller's warehouse count, and finite so a
 * pathologically contended listing cannot hold a transaction open.
 */
const MAX_RESERVATION_ATTEMPTS = 50;

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
    private readonly slots: SlotsService,
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
      this.assertCodAllowed(quote, input);

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

      /**
       * The slot is BOOKED BEFORE the orders are written.
       *
       * If capacity has gone, this throws and nothing has been placed. The
       * other order - place, then book - would leave orders pointing at a
       * window the courier cannot service, and the buyer would have paid for a
       * promise nobody can keep.
       */
      const slotId = await this.bookSlot(tx, quote, input.deliverySlotId);

      const orders = await this.placeOrders(tx, {
        quote,
        userId,
        intentId: intent.id,
        address,
        ageVerified: quote.requiresAgeCheck,
        slotId,
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
   * PRD 9.1: cash on delivery is offered "where the zone allows it".
   *
   * ENFORCED HERE, not only hidden in the UI. The storefront withdraws the
   * option when `zone.codAllowed` is false, but a payment method arrives in a
   * request body and the rule that decides whether money can be collected at
   * the door cannot live in a radio button. Same reasoning as the price check
   * above: nothing a client sends becomes a fact about the order.
   *
   * An UNSERVICEABLE address (`zone === null`) does not fail here. It cannot
   * reach this point - the address was chosen from the buyer's own book and
   * checkout quoted it - and refusing COD for an address the rate card merely
   * has no row for would withdraw the country's most common payment method on
   * the strength of a seed gap. The zone has to exist and say no.
   */
  /**
   * Validates and takes one unit of the chosen window's capacity.
   *
   * THE SLOT MUST BELONG TO THE ZONE THE ADDRESS RESOLVED TO. Without that
   * check a buyer could post any slot id and book a courier's Dhaka morning for
   * a parcel going to Sylhet - the id is caller-supplied, and the only thing
   * that makes it meaningful is the zone it belongs to. Same reasoning as the
   * price check: nothing a client sends becomes a fact about the order.
   */
  private async bookSlot(
    tx: Transaction,
    quote: Quote,
    slotId: string | undefined,
  ): Promise<string | null> {
    if (slotId === undefined) return null;

    if (quote.zone === null) {
      throw new ConflictException({
        code: 'SLOT_NOT_AVAILABLE',
        message: 'We do not schedule deliveries to that address.',
      });
    }
    if (!(await this.slots.belongsToZone(tx, slotId, quote.zone.id))) {
      throw new ConflictException({
        code: 'SLOT_WRONG_ZONE',
        message: 'That delivery window is not offered where this order is going.',
      });
    }

    await this.slots.book(tx, slotId);
    return slotId;
  }

  private assertCodAllowed(quote: Quote, input: ConfirmInput): void {
    if (input.paymentMethod !== 'cod') return;
    if (quote.zone === null || quote.zone.codAllowed) return;

    throw new ConflictException({
      message: `No courier collects cash in ${quote.zone.areaName}. Pay by card to have it delivered there.`,
      code: 'COD_NOT_AVAILABLE',
    });
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
  ): Promise<{ warehouseId: string; quantity: number }[]> {
    let remaining = quantity;
    const taken_from: { warehouseId: string; quantity: number }[] = [];

    /**
     * ACROSS WAREHOUSES, in priority order, taking what each one can give.
     *
     * Phase 4 required a SINGLE inventory row to hold the whole quantity, and
     * Phase 6 found what that costs. A seller with three units in Dhaka and
     * three in Chattogram could not sell four - while `listings.available_stock`,
     * which SUMS across warehouses, went on advertising six. The buyer was told
     * "sold out while you were checking out" about stock that existed and was
     * on the page a second earlier.
     *
     * It also made multi-warehouse dispatch unreachable: reserving everything
     * against one row meant every order had exactly one origin, so the
     * allocator could never split one.
     *
     * THE TAKE IS COMPUTED IN A CTE, not in RETURNING. Postgres evaluates
     * RETURNING against the NEW row, so `LEAST(remaining, on_hand - reserved)`
     * there reads the already-incremented `reserved` and yields zero - the
     * first version of this did exactly that and reported every checkout sold
     * out.
     *
     * Both halves of the Phase 4 locking discipline survive: `FOR UPDATE` lives
     * in the CTE so the subquery takes the lock, and the availability predicate
     * is repeated in the outer WHERE so it is re-checked after the lock.
     */
    for (let attempt = 0; remaining > 0; attempt += 1) {
      /**
       * A bound, because the loop can now legitimately make no progress: the
       * row this iteration picked may have been drained by a concurrent
       * checkout between the CTE's snapshot and the lock, in which case the
       * outer predicate fails and zero rows update. Retrying is right - another
       * warehouse may still have stock - but retrying forever on a genuinely
       * sold-out listing would be a hot loop holding an open transaction.
       */
      if (attempt >= MAX_RESERVATION_ATTEMPTS) {
        throw new ConflictException(`${productName} sold out while you were checking out`);
      }

      const updated = await tx.execute<{ taken: number; warehouse_id: string }>(sql`
        WITH target AS (
          SELECT c.id, c.warehouse_id, LEAST(${remaining}, c.on_hand - c.reserved) AS take
            FROM inventory_items c
            JOIN warehouses w ON w.id = c.warehouse_id
           WHERE c.listing_id = ${listingId} AND (c.on_hand - c.reserved) > 0
           ORDER BY w.priority ASC, c.id ASC
           LIMIT 1
           FOR UPDATE OF c
        )
        UPDATE inventory_items i
           SET reserved = i.reserved + target.take, updated_at = now()
          FROM target
         WHERE i.id = target.id
           AND (i.on_hand - i.reserved) >= target.take
        RETURNING target.take AS taken, target.warehouse_id AS warehouse_id
      `);

      const row = updated.rows[0];
      if (row === undefined) {
        /**
         * Either nothing is available anywhere, or the chosen row was drained
         * under us. `hasAvailability` tells the two apart, so a sold-out
         * listing fails immediately and a contended one retries.
         */
        if (!(await this.hasAvailability(tx, listingId))) {
          throw new ConflictException(`${productName} sold out while you were checking out`);
        }
        continue;
      }

      const taken = Number(row.taken);
      if (!Number.isFinite(taken) || taken <= 0) {
        throw new ConflictException(`${productName} sold out while you were checking out`);
      }

      remaining -= taken;
      taken_from.push({ warehouseId: row.warehouse_id, quantity: taken });
    }

    return taken_from;
  }

  /** Is there a single unit of this listing free anywhere? */
  private async hasAvailability(tx: Transaction, listingId: string): Promise<boolean> {
    const rows = await tx.execute<{ any_left: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM inventory_items
         WHERE listing_id = ${listingId} AND (on_hand - reserved) > 0
      ) AS any_left
    `);
    return rows.rows[0]?.any_left === true;
  }

  private async placeOrders(
    tx: Transaction,
    input: {
      quote: Quote;
      userId: string;
      intentId: string;
      address: Awaited<ReturnType<AddressesService['forCheckout']>>;
      ageVerified: boolean;
      /** One window for the whole cart - a slot is a zone's capacity, not a seller's. */
      slotId: string | null;
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
          const taken = await this.reserve(tx, line.listingId, line.quantity, line.productName);
          /**
           * WHERE the units are held is recorded, not just that they are.
           *
           * `inventory_items.reserved` is a total with no link to an order, so
           * without this a later dispatch of order B could consume the units
           * order A reserved - they look identical on the row. Writing the
           * split here, inside the seller's scope where the reservation
           * happened, is what makes `FulfilmentService.plan` exact rather than
           * a guess.
           */
          const orderItemId = inserted.itemIdsByListing.get(line.listingId);
          if (orderItemId !== undefined && taken.length > 0) {
            await tx.insert(schema.orderItemAllocations).values(
              taken.map((pick) => ({
                tenantId: group.sellerId,
                orderItemId,
                warehouseId: pick.warehouseId,
                quantity: pick.quantity,
              })),
            );
          }
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
      slotId: string | null;
    },
  ): Promise<{
    id: string;
    orderNumber: string;
    /**
     * The order-item id for each listing, so the caller can attach the
     * reservation's warehouse split to the right line without re-reading them.
     */
    itemIdsByListing: Map<string, string>;
  }> {
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
          deliverySlotId: input.slotId,
        })
        .returning({ id: schema.orders.id, orderNumber: schema.orders.orderNumber });
      if (order === undefined) throw new Error('Order insert returned no row');

      const itemIdsByListing = new Map<string, string>();
      for (const line of group.lines) {
        const [item] = await tx.insert(schema.orderItems).values({
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
        }).returning({ id: schema.orderItems.id });
        if (item === undefined) throw new Error('Order item insert returned no row');
        itemIdsByListing.set(line.listingId, item.id);
      }

      return { ...order, itemIdsByListing };
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
