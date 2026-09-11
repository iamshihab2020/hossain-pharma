import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql, sum } from 'drizzle-orm';
import { type Transaction, schema } from '@nexmarket/db';
import {
  type AllocationPlan,
  InvalidTransitionError,
  type OrderStatus,
  type WarehouseStock,
  allocateStock,
  assertTransition,
  money,
  releaseEntries,
  reversalEntries,
  shareFor,
  splitsAcrossWarehouses,
  statusFromCoverage,
  unitShares,
} from '@nexmarket/shared';
import { getRequestContext } from '../../common/request-context.js';
import { asTenantScope } from '../../common/tenant-scope.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ListingsService } from '../listings/listings.service.js';
import { OrdersService, type OrderDetailView } from '../orders/orders.service.js';
import { SearchIndexService } from '../search/search-index.service.js';
import type { AutoDispatchInput, CreateShipmentInput } from './dto.js';
import {
  SHIPPING_PROVIDER,
  type ShippingProvider,
} from '../shipping/shipping-provider.port.js';
import { OrderEventsService, type EventActor } from './order-events.service.js';

/** One order line, with everything the coverage arithmetic needs. */
type Line = {
  id: string;
  listingId: string;
  quantity: number;
  cancelledQuantity: number;
  shippedQuantity: number;
  unitPriceAmount: number;
};

type LoadedOrder = {
  id: string;
  tenantId: string;
  buyerUserId: string;
  paymentIntentId: string;
  status: OrderStatus;
  totalAmount: number;
  commissionAmount: number;
  currency: string;
  lines: Line[];
};

type CancelPick = { orderItemId: string; quantity: number };

export type ShipmentView = {
  id: string;
  orderId: string;
  shipmentNumber: string;
  /**
   * Widened in Phase 6 by the carrier feed. The two middle states are reported
   * by a courier, never set by a person - see `TRACKING_EVENTS`.
   */
  status: 'DISPATCHED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

  /**
   * NO `warehouseId`, deliberately, and this view is read by BUYERS.
   *
   * Which of a seller's buildings a parcel left is warehouse operations, not
   * order history - the same call migration 0020 makes by giving
   * `order_item_allocations` no buyer policy at all. Publishing it here would
   * hand every buyer a seller's internal stock distribution, one order at a
   * time.
   *
   * The seller console gets origins from the dispatch plan and the
   * auto-dispatch response, which name warehouses outright.
   */
  carrierName: string | null;
  trackingNumber: string | null;
  released: { amount: number; currency: string };
  commission: { amount: number; currency: string };
  dispatchedAt: Date;
  deliveredAt: Date | null;
  items: { orderItemId: string; quantity: number }[];
};

/** A replayed idempotency key returns the ORIGINAL parcel, never a second one. */
export type DispatchResult = { shipment: ShipmentView; created: boolean };

/** One warehouse's share of a dispatch, named for the seller rather than keyed. */
export type PlannedAllocation = {
  warehouseId: string;
  warehouseName: string;
  picks: { orderItemId: string; quantity: number }[];
};

/** A dry run: what auto-dispatch would produce, shown before the button. */
export type DispatchPlanView = {
  splits: boolean;
  allocations: PlannedAllocation[];
  /** Units no warehouse can fill. A short plan is still worth dispatching. */
  unfulfilled: { orderItemId: string; quantity: number }[];
};

export type AutoDispatchResult = {
  shipments: ShipmentView[];
  splits: boolean;
  warehouses: { id: string; name: string }[];
  unfulfilled: { orderItemId: string; quantity: number }[];
};

/**
 * The write half of an order's life: accept, reject, dispatch, deliver, cancel.
 *
 * Two rules hold throughout and are worth stating once rather than at every
 * method:
 *
 *   - **No method sets a status.** Callers accept, ship or cancel, and
 *     `statusFromCoverage` decides what the order now is. That is what keeps
 *     `orders.status` from disagreeing with `shipment_items`, since only one of
 *     the two can be recomputed from the other.
 *   - **Nothing here filters by tenant.** `orders`, `order_items`, `shipments`
 *     and `order_events` are all governed by RLS, and an application `WHERE
 *     tenant_id` would produce correct answers while masking a policy
 *     regression - the same argument `OrdersService` makes at length.
 */
@Injectable()
export class FulfilmentService {
  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
    private readonly ledger: LedgerService,
    private readonly listings: ListingsService,
    private readonly search: SearchIndexService,
    /**
     * The PORT, not the mock.
     *
     * Dispatch needs one thing from a carrier - hand over a parcel, get a
     * tracking number - and depending on the concrete adapter would make
     * swapping it a change here rather than one line in ShippingModule.
     * TrackingService deliberately takes the concrete one instead, because the
     * time-compressed schedule it reads is a property of the MOCK and not
     * something a real carrier would ever expose.
     */
    @Inject(SHIPPING_PROVIDER) private readonly carrier: ShippingProvider,
  ) {}

  /** The seller takes the order on. */
  async accept(orderId: string): Promise<OrderDetailView> {
    const { tx, userId } = getRequestContext();
    const order = await this.load(tx, orderId);
    this.assertAllowed(order.status, 'ACCEPTED', 'SELLER');
    await this.assertPayableOrCod(tx, order);

    await tx
      .update(schema.orders)
      .set({ status: 'ACCEPTED', updatedAt: new Date() })
      .where(eq(schema.orders.id, orderId));

    await this.events.record(tx, order, {
      type: 'ACCEPTED',
      actor: 'SELLER',
      actorUserId: userId,
    });

    return this.orders.forSellerOne(orderId);
  }

  /**
   * The seller declines before accepting.
   *
   * REJECTED rather than CANCELLED, deliberately: a buyer reading their history
   * must be able to tell "I cancelled this" from "the seller would not fulfil
   * it" without reading an event log, and Phase 7 wants a rejection rate.
   *
   * Everything else is a cancellation of every line - the stock goes back, the
   * buyer is owed - so it runs the same code, and only the terminal status
   * differs.
   */
  async reject(orderId: string, reason: string): Promise<OrderDetailView> {
    const { tx, userId } = getRequestContext();
    const order = await this.load(tx, orderId);
    this.assertAllowed(order.status, 'REJECTED', 'SELLER');

    await this.cancelLines(tx, order, outstandingOf(order), {
      actor: 'SELLER',
      actorUserId: userId,
      reason,
      eventType: 'REJECTED',
      finalStatus: 'REJECTED',
    });

    return this.orders.forSellerOne(orderId);
  }


  /**
   * Dispatch: the parcel leaves, and the seller's money leaves clearing.
   *
   * The order of operations is the design, and each step is here for a reason:
   *
   *   1. idempotency FIRST, decided by a unique constraint rather than a prior
   *      SELECT that two concurrent retries would both pass;
   *   2. the units are claimed under a row lock, because the shipped counter
   *      lives in another table and so cannot be a conditional UPDATE;
   *   3. the ledger releases exactly those units' allocated share - this is
   *      where a seller first becomes owed anything at all;
   *   4. stock leaves the shelf AND its reservation together, so what a buyer
   *      can buy is unchanged and no reindex is needed;
   *   5. the status is recomputed from coverage, never set.
   */
  async createShipment(orderId: string, input: CreateShipmentInput): Promise<DispatchResult> {
    const { tx, userId } = getRequestContext();
    const order = await this.load(tx, orderId);

    // ACCEPTED or PARTIALLY_SHIPPED may ship; anything else is a 409. SHIPPED
    // is the target asked about because a parcel that completes the order lands
    // there - which of the two it actually was is statusFromCoverage's call.
    this.assertAllowed(order.status, 'SHIPPED', 'SELLER');

    const existing = await this.shipmentByKey(tx, input.idempotencyKey);
    if (existing !== null) return { shipment: existing, created: false };

    const byId = new Map(order.lines.map((line) => [line.id, line]));
    for (const pick of input.items) {
      if (!byId.has(pick.orderItemId)) {
        throw new NotFoundException(`Order item ${pick.orderItemId} is not on this order`);
      }
      await this.claimUnits(tx, pick);
    }

    const share = shareFor(this.sharesFor(order), consumedOf(order), input.items);

    const [row] = await tx
      .insert(schema.shipments)
      .values({
        tenantId: order.tenantId,
        orderId: order.id,
        shipmentNumber: shipmentNumber(),
        carrierName: input.carrierName ?? null,
        trackingNumber: input.trackingNumber ?? null,
        warehouseId: input.warehouseId ?? null,
        releaseAmount: share.total.amount,
        releaseCommission: share.commission.amount,
        currency: share.total.currency,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    if (row === undefined) throw new ConflictException('Shipment could not be created');

    await tx.insert(schema.shipmentItems).values(
      input.items.map((pick) => ({
        tenantId: order.tenantId,
        shipmentId: row.id,
        orderItemId: pick.orderItemId,
        quantity: pick.quantity,
      })),
    );

    await this.ledger.post(tx, {
      paymentIntentId: order.paymentIntentId,
      kind: 'FULFILMENT',
      entries: releaseEntries(order.tenantId, share),
    });

    for (const pick of input.items) {
      const line = byId.get(pick.orderItemId);
      if (line === undefined) continue;
      await this.releaseStock(tx, pick, line.listingId, input.warehouseId);
      // NO reindex here, and that is not an oversight. on_hand and reserved
      // fall TOGETHER, so `available = on_hand - reserved` is unchanged: the
      // goods left the shelf and left their reservation at the same moment, and
      // what a buyer can buy did not move. The recompute still runs, because
      // available_stock caches that difference and one writer owns it.
      await this.listings.recomputeAvailableStock(tx, line.listingId);
    }

    const shipped = applyShipments(order, input.items);
    await tx
      .update(schema.orders)
      .set({ status: statusFromCoverage(coverageOf(shipped), order.status), updatedAt: new Date() })
      .where(eq(schema.orders.id, order.id));

    await this.events.record(tx, order, {
      type: 'SHIPMENT_DISPATCHED',
      actor: 'SELLER',
      actorUserId: userId,
      payload: {
        shipmentId: row.id,
        shipmentNumber: row.shipmentNumber,
        ...(input.carrierName === undefined ? {} : { carrierName: input.carrierName }),
        ...(input.trackingNumber === undefined ? {} : { trackingNumber: input.trackingNumber }),
        items: input.items,
        released: { amount: share.total.amount, currency: share.total.currency },
      },
    });

    return { shipment: toShipmentView(row, input.items), created: true };
  }

  /**
   * What dispatching everything outstanding WOULD look like, without doing it.
   *
   * The seller console shows this before the button is pressed, because "this
   * order will go as two parcels from two warehouses" is something a seller
   * wants to know while they can still change it - by moving stock, or by
   * shipping one line now and the rest later.
   */
  async plan(orderId: string): Promise<DispatchPlanView> {
    const { tx } = getRequestContext();
    const order = await this.load(tx, orderId);
    const outstanding = outstandingOf(order);

    if (outstanding.length === 0) {
      return { splits: false, allocations: [], unfulfilled: [] };
    }

    const { plan, warehouseNames } = await this.planFor(tx, order, outstanding);

    return {
      splits: splitsAcrossWarehouses(plan),
      allocations: plan.allocations.map((allocation) => ({
        warehouseId: allocation.warehouseId,
        warehouseName: warehouseNames.get(allocation.warehouseId) ?? 'Unknown warehouse',
        picks: allocation.picks.map((pick) => ({ ...pick })),
      })),
      unfulfilled: plan.unfulfilled.map((pick) => ({ ...pick })),
    };
  }

  /**
   * Dispatches every outstanding unit, as one parcel per warehouse.
   *
   * PRD 11 Phase 6's acceptance criterion: "an order allocates across two
   * warehouses and produces two shipments".
   *
   * EACH PARCEL GETS ITS OWN IDEMPOTENCY KEY, derived from the request key and
   * the warehouse. That is what makes a retried auto-dispatch safe: the unique
   * constraint on `shipments.idempotency_key` matches every parcel the first
   * attempt created, `createShipment` returns those unchanged, and only
   * genuinely new parcels are made. One key for the whole request would make
   * the second parcel look like a duplicate of the first.
   */
  async autoDispatch(orderId: string, input: AutoDispatchInput): Promise<AutoDispatchResult> {
    const { tx } = getRequestContext();
    const order = await this.load(tx, orderId);

    /**
     * THE REPLAY CHECK COMES BEFORE THE STATUS CHECK, and the order matters.
     *
     * A successful auto-dispatch leaves the order SHIPPED, and SHIPPED has no
     * SHIPPED transition - so a retry hit `assertAllowed` and got a 409 saying
     * the order could not be dispatched, when in fact it already had been. A
     * client that is unsure whether its request landed is exactly the client
     * that retries, and answering "invalid transition" tells it the opposite of
     * the truth.
     *
     * `createShipment` has the same protection one level down, keyed on the
     * per-parcel idempotency key; this is the same idea for the request that
     * produced several of them.
     */
    const replayed = await this.shipmentsForRequest(tx, orderId, input.idempotencyKey);
    if (replayed.length > 0) {
      return {
        shipments: replayed,
        splits: replayed.length > 1,
        warehouses: await this.warehousesOf(tx, replayed),
        unfulfilled: [],
      };
    }

    this.assertAllowed(order.status, 'SHIPPED', 'SELLER');

    const outstanding = outstandingOf(order);
    if (outstanding.length === 0) {
      throw new ConflictException({
        code: 'NOTHING_OUTSTANDING',
        message: 'Every unit on this order has already shipped or been cancelled.',
      });
    }

    const { plan, warehouseNames } = await this.planFor(tx, order, outstanding);

    if (plan.allocations.length === 0) {
      throw new ConflictException({
        code: 'NO_STOCK',
        message: 'None of your warehouses holds stock for the outstanding lines.',
      });
    }

    const shipments: ShipmentView[] = [];
    for (const allocation of plan.allocations) {
      /**
       * A carrier booking PER PARCEL, not per order.
       *
       * Two boxes leaving two buildings are two consignments with two tracking
       * numbers, and a buyer following one number for a shipment that is
       * really two is being told something false.
       */
      const booking =
        input.bookCarrier === true
          ? await this.carrier.book({
              shipmentId: allocation.warehouseId,
              originPostcode: '',
              destinationPostcode: '',
              chargeableGrams: null,
            })
          : null;

      const carrierFields =
        booking === null
          ? {
              ...(input.carrierName === undefined ? {} : { carrierName: input.carrierName }),
              ...(input.trackingNumber === undefined
                ? {}
                : { trackingNumber: input.trackingNumber }),
            }
          : { carrierName: booking.carrierName, trackingNumber: booking.trackingNumber };

      const { shipment } = await this.createShipment(orderId, {
        items: allocation.picks.map((pick) => ({ ...pick })),
        warehouseId: allocation.warehouseId,
        idempotencyKey: `${input.idempotencyKey}:${allocation.warehouseId}`,
        ...carrierFields,
      });
      shipments.push(shipment);
    }

    return {
      shipments,
      splits: shipments.length > 1,
      warehouses: plan.allocations.map((allocation) => ({
        id: allocation.warehouseId,
        name: warehouseNames.get(allocation.warehouseId) ?? 'Unknown warehouse',
      })),
      unfulfilled: plan.unfulfilled.map((pick) => ({ ...pick })),
    };
  }

  /**
   * Reads per-warehouse availability and runs the allocator.
   *
   * `reserved`, not `on_hand`, is what an outstanding order line may draw on.
   * Checkout moved these units into `reserved` at placement, so what can go in
   * this parcel is what THIS order is holding rather than everything on the
   * shelf - allocating against on_hand would let one dispatch consume units
   * another order had already reserved.
   */
  /**
   * Every parcel one auto-dispatch request made.
   *
   * Matched on the `<requestKey>:<warehouseId>` prefix that `autoDispatch`
   * mints. A LIKE on an escaped literal rather than a stored request id: the
   * key is already unique per parcel and already indexed, and a second column
   * would be a second thing that can disagree with the first.
   */
  private async shipmentsForRequest(
    tx: Transaction,
    orderId: string,
    requestKey: string,
  ): Promise<ShipmentView[]> {
    const rows = await tx
      .select()
      .from(schema.shipments)
      .where(
        and(
          eq(schema.shipments.orderId, orderId),
          // Escaped, so a key containing % or _ cannot widen the match into
          // another request's parcels.
          sql`${schema.shipments.idempotencyKey} LIKE ${`${requestKey.replace(/([%_\\])/g, '\\$1')}:%`} ESCAPE '\\'`,
        ),
      )
      .orderBy(asc(schema.shipments.shipmentNumber));

    const views: ShipmentView[] = [];
    for (const row of rows) {
      const items = await tx
        .select({
          orderItemId: schema.shipmentItems.orderItemId,
          quantity: schema.shipmentItems.quantity,
        })
        .from(schema.shipmentItems)
        .where(eq(schema.shipmentItems.shipmentId, row.id));
      views.push(toShipmentView(row, items));
    }
    return views;
  }

  /**
   * The buildings a set of parcels left, named.
   *
   * Reads the ORIGINS OFF THE SHIPMENT ROWS rather than off `ShipmentView`,
   * because that view deliberately does not carry one - it is the shape buyers
   * read. Joining here keeps the origin on the seller's side of the fence.
   */
  private async warehousesOf(
    tx: Transaction,
    shipments: readonly ShipmentView[],
  ): Promise<{ id: string; name: string }[]> {
    const ids = shipments.map((parcel) => parcel.id);
    if (ids.length === 0) return [];

    const rows = await tx
      .selectDistinct({ id: schema.warehouses.id, name: schema.warehouses.name })
      .from(schema.shipments)
      .innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.shipments.warehouseId))
      .where(inArray(schema.shipments.id, ids));
    return rows;
  }

  /**
   * Reads THIS ORDER'S recorded reservations and runs the allocator.
   *
   * `order_item_allocations`, not `inventory_items.reserved`. The reserved
   * counter is a total with no link to an order, so allocating against it let
   * one order's dispatch consume the units another had reserved - identical
   * rows, no way to tell them apart, and the robbed order simply failed to ship
   * later. Checkout records the split at reservation time; this reads it back.
   *
   * The allocator still runs rather than the rows being used directly, because
   * the two are not the same question: the rows say what is held, and
   * `allocateStock` decides how the OUTSTANDING units (which cancellations and
   * earlier parcels have already reduced) map onto them, in a deterministic
   * order.
   */
  private async planFor(
    tx: Transaction,
    order: LoadedOrder,
    outstanding: readonly CancelPick[],
  ): Promise<{ plan: AllocationPlan; warehouseNames: Map<string, string> }> {
    const orderItemIds = outstanding.map((pick) => pick.orderItemId);

    const warehouses = await tx
      .select({
        id: schema.warehouses.id,
        name: schema.warehouses.name,
        priority: schema.warehouses.priority,
      })
      .from(schema.warehouses)
      .orderBy(asc(schema.warehouses.priority), asc(schema.warehouses.id));

    const held =
      orderItemIds.length === 0
        ? []
        : await tx
            .select({
              orderItemId: schema.orderItemAllocations.orderItemId,
              warehouseId: schema.orderItemAllocations.warehouseId,
              quantity: schema.orderItemAllocations.quantity,
            })
            .from(schema.orderItemAllocations)
            .where(inArray(schema.orderItemAllocations.orderItemId, orderItemIds));

    const stock: WarehouseStock[] = warehouses.map((warehouse) => {
      const available = new Map<string, number>();
      for (const row of held) {
        if (row.warehouseId !== warehouse.id) continue;
        if (row.quantity <= 0) continue;
        available.set(row.orderItemId, row.quantity);
      }
      return { warehouseId: warehouse.id, priority: warehouse.priority, available };
    });

    return {
      plan: allocateStock(
        outstanding.map((pick) => ({ orderItemId: pick.orderItemId, quantity: pick.quantity })),
        stock,
      ),
      warehouseNames: new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name])),
    };
  }

  /**
   * Draws units off this order's holding at one warehouse.
   *
   * Conditional, with the quantity repeated in the WHERE, so two concurrent
   * dispatches of the same line cannot both take the same units - the same
   * shape as every other stock movement in this codebase, for the same reason.
   */
  private async consumeAllocation(
    tx: Transaction,
    orderItemId: string,
    warehouseId: string,
    quantity: number,
  ): Promise<void> {
    await tx
      .update(schema.orderItemAllocations)
      .set({ quantity: sql`${schema.orderItemAllocations.quantity} - ${quantity}` })
      .where(
        and(
          eq(schema.orderItemAllocations.orderItemId, orderItemId),
          eq(schema.orderItemAllocations.warehouseId, warehouseId),
          sql`${schema.orderItemAllocations.quantity} >= ${quantity}`,
        ),
      );
  }


  /**
   * The parcel arrived.
   *
   * NO LEDGER POSTING, and this is the obvious place to come looking for one.
   * The money moved at DISPATCH - see `releaseEntries` - so delivery changes
   * nothing about who is owed what. When Phase 6 replaces this button with
   * carrier tracking events, the trigger changes and this stays empty.
   *
   * The ORDER becomes DELIVERED only when no parcel is still in transit and no
   * unit is still outstanding: a seller who has shipped half and delivered that
   * half has not delivered the order.
   */
  async markDelivered(orderId: string, shipmentId: string): Promise<ShipmentView> {
    const { tx, userId } = getRequestContext();
    const order = await this.load(tx, orderId);

    const rows = await tx
      .select()
      .from(schema.shipments)
      .where(and(eq(schema.shipments.id, shipmentId), eq(schema.shipments.orderId, orderId)))
      .limit(1);
    const parcel = rows[0];
    // A 404, not a 403: under RLS a parcel that is not yours does not exist.
    if (parcel === undefined) throw new NotFoundException('No such shipment');
    if (parcel.status === 'DELIVERED') {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        from: 'DELIVERED',
        to: 'DELIVERED',
        message: 'That parcel is already marked delivered',
      });
    }

    const delivered = new Date();
    await tx
      .update(schema.shipments)
      .set({ status: 'DELIVERED', deliveredAt: delivered, updatedAt: delivered })
      .where(eq(schema.shipments.id, shipmentId));

    /**
     * "NOT DELIVERED", not "== DISPATCHED".
     *
     * Phase 5 could write `status = 'DISPATCHED'` because those were the only
     * two shipment states. Phase 6 added IN_TRANSIT and OUT_FOR_DELIVERY, and
     * the old predicate would have counted a parcel on a van as *not* in
     * transit - so delivering one parcel of two would have marked the whole
     * order DELIVERED while the second was still moving.
     *
     * Written as the negative deliberately: the question is "is anything still
     * out there", and a positive list has to be revisited every time the
     * carrier vocabulary grows. This is the one place that vocabulary is
     * load-bearing for order status.
     */
    const inTransit = await tx
      .select({ id: schema.shipments.id })
      .from(schema.shipments)
      .where(and(eq(schema.shipments.orderId, orderId), ne(schema.shipments.status, 'DELIVERED')));

    const outstanding = outstandingOf(order).length;
    if (inTransit.length === 0 && outstanding === 0) {
      this.assertAllowed(order.status, 'DELIVERED', 'SELLER');
      await tx
        .update(schema.orders)
        .set({ status: 'DELIVERED', updatedAt: delivered })
        .where(eq(schema.orders.id, orderId));
    }

    await this.events.record(tx, order, {
      type: 'SHIPMENT_DELIVERED',
      actor: 'SELLER',
      actorUserId: userId,
      payload: { shipmentId, shipmentNumber: parcel.shipmentNumber },
    });

    const items = await tx
      .select({
        orderItemId: schema.shipmentItems.orderItemId,
        quantity: schema.shipmentItems.quantity,
      })
      .from(schema.shipmentItems)
      .where(eq(schema.shipmentItems.shipmentId, shipmentId));

    return toShipmentView(
      { ...parcel, status: 'DELIVERED', deliveredAt: delivered },
      items,
    );
  }


  /**
   * The seller cancels units they cannot send.
   *
   * Line-level, so it is the one path that can leave a PARTLY shipped order:
   * cancelling the outstanding remainder lands it on SHIPPED, because every unit
   * that was ever going to move has moved.
   *
   * The transition table is not consulted for the TARGET here, deliberately -
   * it answers "may this actor move the order to CANCELLED", and the answer
   * after a cancellation is computed from coverage rather than chosen. What is
   * checked instead is narrower: is this order still open enough to lose lines.
   */
  async cancelLinesForSeller(
    orderId: string,
    picks: CancelPick[] | undefined,
    reason: string,
  ): Promise<OrderDetailView> {
    const { tx, userId } = getRequestContext();
    const order = await this.load(tx, orderId);
    assertCancellable(order.status);

    await this.cancelLines(tx, order, picks ?? outstandingOf(order), {
      actor: 'SELLER',
      actorUserId: userId,
      reason,
      eventType: 'LINES_CANCELLED',
    });

    return this.orders.forSellerOne(orderId);
  }

  /**
   * The buyer cancels their own order, and THE FOURTH TENANT-SCOPE ESCAPE.
   *
   * `tenant-scope.ts` says to stop and ask before adding one, so this is the
   * answer. A buyer cancelling writes to `orders`, `order_items`,
   * `inventory_items` and `order_events` - all tenant-owned - and a buyer is not
   * a tenant. The alternatives were considered and rejected in ADR 0019:
   *
   *   - running it as a platform admin hands a buyer's transaction every
   *     tenant's rows to solve a narrow write problem, which ADR 0017 already
   *     rejected once;
   *   - a gated buyer UPDATE policy is expressible on `orders` alone and NOT on
   *     `inventory_items`, and a buyer-writable inventory policy is not a thing
   *     this codebase should own;
   *   - making cancellation a request the seller actions turns a button into a
   *     support ticket.
   *
   * The safety rule holds unchanged, and it is the whole reason this is allowed:
   * the tenant is `orders.tenant_id`, READ FROM THE DATABASE inside this
   * transaction, after `own_orders` has already proved the order is this
   * buyer's. The buyer chose an order, never a tenant, so no caller-supplied
   * value reaches the call.
   *
   * Whole-order only. A buyer wanting to drop one item of several is asking for
   * a return, which is Phase 8.
   */
  async cancelForBuyer(orderId: string, reason: string | undefined): Promise<OrderDetailView> {
    const { tx, userId } = getRequestContext();
    // No tenant is selected on a buyer's request, so `own_orders` is the policy
    // that answers this - and it answers 404 for somebody else's order.
    const order = await this.load(tx, orderId);
    this.assertAllowed(order.status, 'CANCELLED', 'BUYER');

    await asTenantScope(tx, order.tenantId, () =>
      this.cancelLines(tx, order, outstandingOf(order), {
        actor: 'BUYER',
        actorUserId: userId,
        reason,
        eventType: 'CANCELLED',
        finalStatus: 'CANCELLED',
      }),
    );

    // Read INSIDE this transaction. forBuyerOne opens its own, which could not
    // see the cancellation that has not committed yet.
    return this.orders.oneWithin(tx, orderId);
  }

  // ---------------------------------------------------------------- internals




  /**
   * Cancels units, and is the ONE place that does.
   *
   * Three things happen together and must not be separated:
   *
   *   1. the units are marked cancelled, guarded so a shipped unit cannot be
   *      cancelled out from under a courier;
   *   2. the ledger reverses exactly those units' allocated share, because the
   *      buyer is owed them from this moment. No seller entry - a seller is
   *      credited on DISPATCH, so nothing was ever credited for units that did
   *      not go;
   *   3. the reservation is released, which INCREASES what a buyer can buy and
   *      therefore must reindex.
   */
  private async cancelLines(
    tx: Transaction,
    order: LoadedOrder,
    picks: CancelPick[],
    how: {
      actor: EventActor;
      actorUserId: string | null;
      reason: string | undefined;
      eventType: 'REJECTED' | 'CANCELLED' | 'LINES_CANCELLED';
      finalStatus?: OrderStatus;
    },
  ): Promise<void> {
    if (picks.length === 0) {
      throw new ConflictException('Nothing left to cancel on this order');
    }

    const byId = new Map(order.lines.map((line) => [line.id, line]));
    for (const pick of picks) {
      const line = byId.get(pick.orderItemId);
      if (line === undefined) {
        throw new NotFoundException(`Order item ${pick.orderItemId} is not on this order`);
      }

      // The ADR 0017 shape: the predicate lives INSIDE the FOR UPDATE subquery
      // and is REPEATED outside, because Postgres re-checks only the outer
      // WHERE after taking the lock. The deferred constraint trigger from
      // migration 0014 is the backstop underneath.
      const updated = await tx.execute(sql`
        UPDATE order_items
           SET cancelled_quantity = cancelled_quantity + ${pick.quantity}
         WHERE id = (
           SELECT oi.id FROM order_items oi
            WHERE oi.id = ${pick.orderItemId}
              AND oi.quantity - oi.cancelled_quantity - ${line.shippedQuantity} >= ${pick.quantity}
            FOR UPDATE
         )
           AND quantity - cancelled_quantity - ${line.shippedQuantity} >= ${pick.quantity}
        RETURNING id
      `);
      if ((updated.rowCount ?? 0) === 0) {
        throw new ConflictException(
          `Only ${line.quantity - line.cancelledQuantity - line.shippedQuantity} unit(s) of that line can still be cancelled`,
        );
      }
    }

    const share = shareFor(this.sharesFor(order), consumedOf(order), picks);
    await this.ledger.post(tx, {
      paymentIntentId: order.paymentIntentId,
      kind: 'REFUND',
      entries: reversalEntries(share),
    });

    for (const pick of picks) {
      const line = byId.get(pick.orderItemId);
      if (line === undefined) continue;
      await this.release(tx, line.listingId, pick.quantity);
      // A write that changes what a buyer would FIND must reindex, and putting
      // the last unit back does exactly that: `in_stock`, `min_price_amount`
      // and `seller_count` all derive from eligible offers. The recompute goes
      // through ListingsService because that class is the single documented
      // writer of `listings.available_stock`.
      await this.listings.recomputeAvailableStock(tx, line.listingId);
      await this.search.reindexForListing(tx, line.listingId);
    }

    const applied = applyCancellations(order, picks);
    const status = how.finalStatus ?? statusFromCoverage(coverageOf(applied), order.status);

    await tx
      .update(schema.orders)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.orders.id, order.id));

    await this.events.record(tx, order, {
      type: how.eventType,
      actor: how.actor,
      actorUserId: how.actorUserId,
      payload: {
        ...(how.reason === undefined ? {} : { reason: how.reason }),
        items: picks,
        reversed: { amount: share.total.amount, currency: share.total.currency },
      },
    });
  }

  /**
   * Puts a reservation back.
   *
   * Same both-halves shape as the reserve it undoes: the predicate is inside
   * the locked subquery and repeated outside. Without it two concurrent
   * cancellations could drive `reserved` below zero, which the CHECK from
   * migration 0008 would then turn into a 500 rather than a clean refusal.
   */
  private async release(tx: Transaction, listingId: string, quantity: number): Promise<void> {
    const updated = await tx.execute(sql`
      UPDATE inventory_items
         SET reserved = reserved - ${quantity}, updated_at = now()
       WHERE id = (
         SELECT id FROM inventory_items
          WHERE listing_id = ${listingId} AND reserved >= ${quantity}
          ORDER BY reserved DESC
          LIMIT 1
          FOR UPDATE
       )
         AND reserved >= ${quantity}
      RETURNING id
    `);
    if ((updated.rowCount ?? 0) === 0) {
      throw new ConflictException('Inventory reservation could not be released');
    }
  }


  /**
   * Takes `pick.quantity` units of a line, or refuses.
   *
   * A row lock rather than the conditional UPDATE the reservation uses, and the
   * difference is forced: the shipped counter is SUM(shipment_items.quantity)
   * in ANOTHER table, so there is no single row whose predicate could be
   * re-checked after the lock. Locking the parent line serialises every
   * dispatch of it instead, and the count that follows is a separate statement,
   * so under READ COMMITTED it sees whatever the transaction ahead of it
   * committed rather than a pre-lock snapshot.
   *
   * The deferred trigger from migration 0014 is the backstop underneath, and it
   * is what makes this safe rather than merely careful.
   */
  private async claimUnits(tx: Transaction, pick: CancelPick): Promise<void> {
    await tx.execute(sql`SELECT id FROM order_items WHERE id = ${pick.orderItemId} FOR UPDATE`);

    const remaining = await tx.execute<{ remaining: number }>(sql`
      SELECT oi.quantity - oi.cancelled_quantity - COALESCE((
               SELECT SUM(si.quantity)::int FROM shipment_items si
                WHERE si.order_item_id = oi.id
             ), 0) AS remaining
        FROM order_items oi
       WHERE oi.id = ${pick.orderItemId}
    `);

    const left = remaining.rows[0]?.remaining ?? 0;
    if (left < pick.quantity) {
      throw new ConflictException(
        `Only ${left} unit(s) of that line are left to ship, and ${pick.quantity} were picked`,
      );
    }
  }

  /**
   * Takes a line's units OFF THE SHELVES THEY WERE HELD ON.
   *
   * A named warehouse is `autoDispatch`, which already planned one parcel per
   * building and is telling us which one this is. No warehouse is the seller
   * packing a box by hand, and that is where this earns its place: the units
   * may be held in two places, because Phase 6 taught RESERVATION to spread
   * across warehouses and did not teach dispatch the same thing. A line of four
   * held as three plus one then matched no single inventory row, `dispatchStock`
   * refused it, and the console answered "that is more than this order has
   * left" about an order that had four units left. Reserving across buildings
   * and being unable to ship across them is worse than not splitting at all.
   *
   * Drawn from `order_item_allocations` rather than from `reserved`, in
   * warehouse priority order. The reserved counter is a TOTAL with no link to
   * an order, so spending it by "whichever row holds the most" is how one
   * order's dispatch consumed another's reservation - the bug this table was
   * added to make impossible, and one the unscoped statement below still has.
   *
   * Anything the allocations cannot cover falls through to that unscoped
   * statement, which is what orders placed before migration 0019 need: they
   * recorded no allocations at all, and they must still ship.
   */
  private async releaseStock(
    tx: Transaction,
    pick: CancelPick,
    listingId: string,
    warehouseId?: string,
  ): Promise<void> {
    if (warehouseId !== undefined) {
      await this.dispatchStock(tx, listingId, pick.quantity, warehouseId);
      await this.consumeAllocation(tx, pick.orderItemId, warehouseId, pick.quantity);
      return;
    }

    const held = await tx
      .select({
        warehouseId: schema.orderItemAllocations.warehouseId,
        quantity: schema.orderItemAllocations.quantity,
      })
      .from(schema.orderItemAllocations)
      .innerJoin(
        schema.warehouses,
        eq(schema.warehouses.id, schema.orderItemAllocations.warehouseId),
      )
      .where(
        and(
          eq(schema.orderItemAllocations.orderItemId, pick.orderItemId),
          sql`${schema.orderItemAllocations.quantity} > 0`,
        ),
      )
      // The seller's own preference, then the id, so the sort is total and one
      // order splits the same way twice. Same ordering the allocator uses.
      .orderBy(asc(schema.warehouses.priority), asc(schema.warehouses.id));

    let remaining = pick.quantity;
    for (const row of held) {
      if (remaining === 0) break;
      const take = Math.min(remaining, row.quantity);
      await this.dispatchStock(tx, listingId, take, row.warehouseId);
      await this.consumeAllocation(tx, pick.orderItemId, row.warehouseId, take);
      remaining -= take;
    }

    if (remaining > 0) {
      await this.dispatchStock(tx, listingId, remaining);
    }
  }

  /**
   * Goods leave the building: on_hand AND reserved both fall.
   *
   * Both, or `available` moves and the buy box starts advertising stock that has
   * already been posted. Same both-halves guard as every other inventory write.
   */
  private async dispatchStock(
    tx: Transaction,
    listingId: string,
    quantity: number,
    warehouseId?: string,
  ): Promise<void> {
    /**
     * The warehouse filter is folded into the SAME statement rather than
     * checked first.
     *
     * A prior `SELECT ... WHERE warehouse_id = $1` followed by this UPDATE
     * would be two snapshots, and the row could be drained between them - the
     * exact shape of the bug Phase 4 fixed in the stock reservation. Passing
     * NULL for "anywhere" keeps one query and one lock for both cases.
     */
    const scope = warehouseId ?? null;
    const updated = await tx.execute(sql`
      UPDATE inventory_items
         SET on_hand = on_hand - ${quantity},
             reserved = reserved - ${quantity},
             updated_at = now()
       WHERE id = (
         SELECT id FROM inventory_items
          WHERE listing_id = ${listingId}
            AND (${scope}::uuid IS NULL OR warehouse_id = ${scope}::uuid)
            AND reserved >= ${quantity} AND on_hand >= ${quantity}
          ORDER BY reserved DESC
          LIMIT 1
          FOR UPDATE
       )
         AND reserved >= ${quantity} AND on_hand >= ${quantity}
      RETURNING id
    `);
    if ((updated.rowCount ?? 0) === 0) {
      throw new ConflictException(
        warehouseId === undefined
          ? 'No reserved stock to dispatch for that listing'
          : 'That warehouse does not hold enough reserved stock for this line',
      );
    }
  }

  /** The parcel this key already made, if it made one. */
  private async shipmentByKey(tx: Transaction, key: string): Promise<ShipmentView | null> {
    const rows = await tx
      .select()
      .from(schema.shipments)
      .where(eq(schema.shipments.idempotencyKey, key))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;

    const items = await tx
      .select({
        orderItemId: schema.shipmentItems.orderItemId,
        quantity: schema.shipmentItems.quantity,
      })
      .from(schema.shipmentItems)
      .where(eq(schema.shipmentItems.shipmentId, row.id));

    return toShipmentView(row, items);
  }

  /** The order total and commission, split across the order's individual units. */
  private sharesFor(order: LoadedOrder) {
    return unitShares(
      money(order.totalAmount, order.currency),
      money(order.commissionAmount, order.currency),
      order.lines.map((line) => ({
        orderItemId: line.id,
        quantity: line.quantity,
        unitPriceAmount: line.unitPriceAmount,
      })),
    );
  }

  /**
   * A 409 with a code, not a 500.
   *
   * There is no exception filter to hang this on - `checkout.service.ts` throws
   * its PRICE_CHANGED conflict inline the same way - and the client's correct
   * response to both is to re-render rather than retry.
   */
  private assertAllowed(from: OrderStatus, to: OrderStatus, actor: EventActor): void {
    try {
      assertTransition(from, to, actor);
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        throw new ConflictException({ code: 'INVALID_TRANSITION', from, to, message: error.message });
      }
      throw error;
    }
  }

  /**
   * The order, its lines, and how much of each has already gone or been lost.
   *
   * Shipped quantity is summed from `shipment_items` rather than read from a
   * column, because a denormalised counter here would have two writers -
   * dispatch and cancellation - and drift under concurrency.
   */
  /**
   * A PENDING_PAYMENT order may be accepted only if it is cash on delivery.
   *
   * The state machine allows PENDING_PAYMENT -> ACCEPTED because shipping
   * before the money arrives is what cash on delivery *means*, and order status
   * describes fulfilment rather than payment. But that edge must not become a
   * way to ship a card order nobody paid for, and `order-state.ts` knows
   * nothing about payment methods and should not learn - so the method check
   * lives here, where the intent is one join away.
   *
   * A prepaid order that has genuinely been paid is already PAID by the time it
   * reaches a seller, because the webhook moved it. So the only orders this
   * turns away are card orders whose payment never arrived, which is exactly
   * the set that should be turned away.
   */
  private async assertPayableOrCod(tx: Transaction, order: LoadedOrder): Promise<void> {
    if (order.status !== 'PENDING_PAYMENT') return;

    const [intent] = await tx
      .select({ provider: schema.paymentIntents.provider })
      .from(schema.paymentIntents)
      .where(eq(schema.paymentIntents.id, order.paymentIntentId))
      .limit(1);

    if (intent?.provider === 'cod') return;

    throw new ConflictException({
      code: 'PAYMENT_NOT_SETTLED',
      message: 'This order has not been paid for yet. It cannot be accepted until it is.',
    });
  }

  private async load(tx: Transaction, orderId: string): Promise<LoadedOrder> {
    const rows = await tx
      .select({
        id: schema.orders.id,
        tenantId: schema.orders.tenantId,
        buyerUserId: schema.orders.buyerUserId,
        paymentIntentId: schema.orders.paymentIntentId,
        status: schema.orders.status,
        totalAmount: schema.orders.totalAmount,
        commissionAmount: schema.orders.commissionAmount,
        currency: schema.orders.currency,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    const order = rows[0];
    // A 404, not a 403. Under RLS an order that is not yours does not exist,
    // and saying "forbidden" would confirm that it does.
    if (order === undefined) throw new NotFoundException('No such order');

    const lines = await tx
      .select({
        id: schema.orderItems.id,
        listingId: schema.orderItems.listingId,
        quantity: schema.orderItems.quantity,
        cancelledQuantity: schema.orderItems.cancelledQuantity,
        unitPriceAmount: schema.orderItems.unitPriceAmount,
      })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));

    /**
     * Shipped quantity as its OWN grouped query, never a correlated subquery in
     * the select list above.
     *
     * ADR 0010, and this cost an afternoon a second time before the note was
     * believed: Drizzle renders column references inside a `sql` template in the
     * SELECT list WITHOUT table qualification, so
     * `WHERE si.order_item_id = ${schema.orderItems.id}` becomes
     * `WHERE si.order_item_id = "id"` - which resolves to shipment_items' OWN
     * id, compares the table to itself, is always false, and raises nothing.
     * Every line reported zero shipped units, so a completed order stayed
     * PARTIALLY_SHIPPED and every parcel re-allocated the same unit shares.
     */
    const ids = lines.map((line) => line.id);
    const shippedByLine = new Map<string, number>();
    if (ids.length > 0) {
      const sums = await tx
        .select({
          orderItemId: schema.shipmentItems.orderItemId,
          shipped: sum(schema.shipmentItems.quantity),
        })
        .from(schema.shipmentItems)
        .where(inArray(schema.shipmentItems.orderItemId, ids))
        .groupBy(schema.shipmentItems.orderItemId);
      for (const row of sums) {
        shippedByLine.set(row.orderItemId, Number(row.shipped ?? 0));
      }
    }

    return {
      ...order,
      lines: lines.map((line) => ({
        id: line.id,
        listingId: line.listingId,
        quantity: line.quantity,
        cancelledQuantity: line.cancelledQuantity,
        shippedQuantity: shippedByLine.get(line.id) ?? 0,
        unitPriceAmount: line.unitPriceAmount,
      })),
    };
  }
}

/** Every unit that has neither shipped nor been cancelled. */
function outstandingOf(order: LoadedOrder): CancelPick[] {
  return order.lines
    .map((line) => ({
      orderItemId: line.id,
      quantity: line.quantity - line.cancelledQuantity - line.shippedQuantity,
    }))
    .filter((pick) => pick.quantity > 0);
}

/**
 * How many units of each line are already spoken for.
 *
 * `shipped + cancelled`, which is exactly the index of the line's next free
 * unit - the order in which `shareFor` consumes them.
 */
function consumedOf(order: LoadedOrder): Map<string, number> {
  return new Map(
    order.lines.map((line) => [line.id, line.shippedQuantity + line.cancelledQuantity]),
  );
}

function applyCancellations(order: LoadedOrder, picks: CancelPick[]): LoadedOrder {
  const extra = new Map(picks.map((pick) => [pick.orderItemId, pick.quantity]));
  return {
    ...order,
    lines: order.lines.map((line) => ({
      ...line,
      cancelledQuantity: line.cancelledQuantity + (extra.get(line.id) ?? 0),
    })),
  };
}

/**
 * Which orders can still lose lines.
 *
 * Not the transition table: that governs where an order MOVES, and after a
 * line cancellation the destination is computed from coverage. This is the
 * narrower question of whether the order is still open at all.
 */
function assertCancellable(status: OrderStatus): void {
  const open: OrderStatus[] = ['PAID', 'ACCEPTED', 'PARTIALLY_SHIPPED'];
  if (!open.includes(status)) {
    throw new ConflictException({
      code: 'INVALID_TRANSITION',
      from: status,
      to: 'CANCELLED',
      message: `An order that is ${status} has nothing left to cancel`,
    });
  }
}

function applyShipments(order: LoadedOrder, picks: CancelPick[]): LoadedOrder {
  const extra = new Map(picks.map((pick) => [pick.orderItemId, pick.quantity]));
  return {
    ...order,
    lines: order.lines.map((line) => ({
      ...line,
      shippedQuantity: line.shippedQuantity + (extra.get(line.id) ?? 0),
    })),
  };
}

function toShipmentView(
  row: typeof schema.shipments.$inferSelect,
  items: { orderItemId: string; quantity: number }[],
): ShipmentView {
  return {
    id: row.id,
    orderId: row.orderId,
    shipmentNumber: row.shipmentNumber,
    status: row.status,
    carrierName: row.carrierName,
    trackingNumber: row.trackingNumber,
    released: { amount: row.releaseAmount, currency: row.currency },
    commission: { amount: row.releaseCommission, currency: row.currency },
    dispatchedAt: row.dispatchedAt,
    deliveredAt: row.deliveredAt,
    items,
  };
}

/** Same shape as `orderNumber` in checkout: human-facing, per seller, unique. */
function shipmentNumber(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const noise = Math.floor(Math.random() * 46_656)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0');
  return `SHP-${stamp}-${noise}`;
}

function coverageOf(order: LoadedOrder) {
  return order.lines.map((line) => ({
    ordered: line.quantity,
    shipped: line.shippedQuantity,
    cancelled: line.cancelledQuantity,
  }));
}
