import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { type Transaction, schema, withTenant } from '@nexmarket/db';
import { decodeCursor, toPage, type Page } from '../../common/pagination.js';
import { getRequestContext } from '../../common/request-context.js';
import { OrderEventsService } from '../fulfilment/order-events.service.js';

export type OrderItemView = {
  id: string;
  listingId: string;
  productName: string;
  variantSku: string;
  quantity: number;
  unitPrice: { amount: number; currency: string };
  lineTotal: { amount: number; currency: string };
};

export type OrderShipmentView = {
  id: string;
  shipmentNumber: string;
  /**
   * Widened in Phase 6 by the carrier feed. The two middle states are reported
   * by a courier, never set by a person - see `TRACKING_EVENTS`.
   *
   * No origin warehouse here either: this is the buyer's view of a parcel, and
   * which building it left is the seller's business. See the note on
   * `ShipmentView` in fulfilment.service.ts.
   */
  status: 'DISPATCHED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED';
  carrierName: string | null;
  trackingNumber: string | null;
  dispatchedAt: Date;
  deliveredAt: Date | null;
  items: { orderItemId: string; quantity: number }[];
};

export type OrderTimelineEntry = {
  id: string;
  type: string;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

/**
 * The DETAIL view carries parcels and history; the list does not.
 *
 * Deliberate: an order history page shows twenty orders, and loading every
 * parcel and every event for each of them is three queries per row to render
 * something no list displays. The detail page is where a buyer looks for it.
 */
export type OrderDetailView = OrderView & {
  /**
   * The address SNAPSHOT taken when the order was placed, not a foreign key.
   *
   * On the detail view only. A packing slip is unusable without it, and the
   * list has no business carrying every buyer's address into a page that shows
   * twenty orders at once.
   */
  shippingAddress: Record<string, unknown>;
  shipments: OrderShipmentView[];
  timeline: OrderTimelineEntry[];
};

export type OrderView = {
  id: string;
  createdAt: Date;
  orderNumber: string;
  status: string;
  sellerId: string;
  sellerName: string;
  subtotal: { amount: number; currency: string };
  shipping: { amount: number; currency: string };
  tax: { amount: number; currency: string };
  total: { amount: number; currency: string };
  placedAt: Date;
  items: OrderItemView[];
};

/**
 * Order reads, for both sides of the marketplace.
 *
 * **Neither method adds a `WHERE tenant_id` or a `WHERE buyer_user_id`.** That
 * is deliberate and is the point: `orders` carries three policies, and the
 * whole design rests on the right one applying in the right context. An
 * application filter here would produce correct answers while masking a policy
 * regression - the tests in `packages/db/src/orders-rls.test.ts` would keep
 * passing and the API would keep looking right, until something that is not
 * this service read the table.
 *
 *   - a SELLER sends x-tenant-id, so `tenant_isolation` applies
 *   - a BUYER sends no tenant, so `own_orders` applies, keyed on app.user_id
 *
 * The only thing that changes between them is which transaction context is
 * opened, which is why `forBuyer` runs its own `withTenant` and `forSeller`
 * takes the interceptor's.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly events: OrderEventsService) {}

  /** The buyer's orders across every seller. No tenant, so `own_orders` rules. */
  async forBuyer(userId: string, limit: number, cursor?: string): Promise<Page<OrderView>> {
    return withTenant({ tenantId: null, userId, isAdmin: false }, (tx) =>
      this.page(tx, limit, cursor),
    );
  }

  async forBuyerOne(userId: string, id: string): Promise<OrderDetailView> {
    return withTenant({ tenantId: null, userId, isAdmin: false }, (tx) => this.one(tx, id));
  }

  /**
   * One order, read inside a transaction the CALLER owns.
   *
   * `forBuyerOne` opens its own transaction, which is right for a plain read
   * and wrong for anything that has just written: a second transaction cannot
   * see uncommitted work, so a buyer cancelling an order would be handed back
   * the state from before their own cancellation.
   */
  async oneWithin(tx: Transaction, id: string): Promise<OrderDetailView> {
    return this.one(tx, id);
  }

  /** One seller's queue. The interceptor has already resolved the tenant. */
  async forSeller(limit: number, cursor?: string): Promise<Page<OrderView>> {
    return this.page(getRequestContext().tx, limit, cursor);
  }

  async forSellerOne(id: string): Promise<OrderDetailView> {
    return this.one(getRequestContext().tx, id);
  }

  // ---------------------------------------------------------------- internals

  private async page(tx: Transaction, limit: number, cursor?: string): Promise<Page<OrderView>> {
    const after = cursor === undefined ? null : decodeCursor(cursor);

    const rows = await tx
      .select({
        id: schema.orders.id,
        createdAt: schema.orders.createdAt,
        orderNumber: schema.orders.orderNumber,
        status: schema.orders.status,
        tenantId: schema.orders.tenantId,
        sellerName: schema.organisations.displayName,
        subtotalAmount: schema.orders.subtotalAmount,
        shippingAmount: schema.orders.shippingAmount,
        taxAmount: schema.orders.taxAmount,
        totalAmount: schema.orders.totalAmount,
        currency: schema.orders.currency,
        placedAt: schema.orders.placedAt,
      })
      .from(schema.orders)
      .innerJoin(schema.organisations, eq(schema.organisations.id, schema.orders.tenantId))
      .where(
        after === null
          ? undefined
          : // Keyset pagination on (createdAt, id): the id breaks ties, so two
            // orders placed in the same millisecond cannot hide each other.
            or(
              lt(schema.orders.createdAt, new Date(after.createdAt)),
              and(
                eq(schema.orders.createdAt, new Date(after.createdAt)),
                lt(schema.orders.id, after.id),
              ),
            ),
      )
      .orderBy(desc(schema.orders.createdAt), desc(schema.orders.id))
      // One extra row answers "is there a next page?" without a COUNT that
      // would be both slower and stale by the time it returned.
      .limit(limit + 1);

    const page = toPage(rows, limit);
    const items = await this.withItems(
      tx,
      page.items.map((row) => row.id),
    );

    return {
      items: page.items.map((row) => toOrder(row, items.get(row.id) ?? [])),
      nextCursor: page.nextCursor,
    };
  }

  private async one(tx: Transaction, id: string): Promise<OrderDetailView> {
    const rows = await tx
      .select({
        id: schema.orders.id,
        createdAt: schema.orders.createdAt,
        orderNumber: schema.orders.orderNumber,
        status: schema.orders.status,
        tenantId: schema.orders.tenantId,
        sellerName: schema.organisations.displayName,
        subtotalAmount: schema.orders.subtotalAmount,
        shippingAmount: schema.orders.shippingAmount,
        taxAmount: schema.orders.taxAmount,
        totalAmount: schema.orders.totalAmount,
        currency: schema.orders.currency,
        placedAt: schema.orders.placedAt,
        shippingAddress: schema.orders.shippingAddress,
      })
      .from(schema.orders)
      .innerJoin(schema.organisations, eq(schema.organisations.id, schema.orders.tenantId))
      .where(eq(schema.orders.id, id))
      .limit(1);

    const row = rows[0];
    // A 404, not a 403. Under RLS an order that is not yours does not exist,
    // and saying "forbidden" would confirm that it does.
    if (row === undefined) throw new NotFoundException('No such order');

    const items = await this.withItems(tx, [row.id]);
    const [shipments, timeline] = await Promise.all([
      this.shipmentsFor(tx, row.id),
      this.events.forOrder(tx, row.id),
    ]);

    return {
      ...toOrder(row, items.get(row.id) ?? []),
      shippingAddress: (row.shippingAddress ?? {}) as Record<string, unknown>,
      shipments,
      timeline,
    };
  }

  /**
   * The parcels on one order.
   *
   * No `WHERE tenant_id` and no buyer filter, for the reason this whole service
   * gives: `shipments` and `shipment_items` carry policies, and an application
   * filter would answer correctly while masking a policy regression. A seller
   * sees their own parcels through `tenant_isolation`; a buyer sees all of
   * theirs through `own_shipments`.
   */
  private async shipmentsFor(tx: Transaction, orderId: string): Promise<OrderShipmentView[]> {
    const rows = await tx
      .select()
      .from(schema.shipments)
      .where(eq(schema.shipments.orderId, orderId))
      .orderBy(schema.shipments.dispatchedAt, schema.shipments.id);
    if (rows.length === 0) return [];

    const lines = await tx
      .select({
        shipmentId: schema.shipmentItems.shipmentId,
        orderItemId: schema.shipmentItems.orderItemId,
        quantity: schema.shipmentItems.quantity,
      })
      .from(schema.shipmentItems)
      .where(
        inArray(
          schema.shipmentItems.shipmentId,
          rows.map((row) => row.id),
        ),
      );

    return rows.map((row) => ({
      id: row.id,
      shipmentNumber: row.shipmentNumber,
      status: row.status,
      carrierName: row.carrierName,
      trackingNumber: row.trackingNumber,
      dispatchedAt: row.dispatchedAt,
      deliveredAt: row.deliveredAt,
      items: lines
        .filter((line) => line.shipmentId === row.id)
        .map((line) => ({ orderItemId: line.orderItemId, quantity: line.quantity })),
    }));
  }

  /**
   * Items for a page of orders, in one query.
   *
   * `order_items` carries the same policies as `orders`, so a seller sees only
   * their own lines on an order and a buyer sees all of theirs - which is
   * Phase 5's "seller sees only their items on a shared order" already holding
   * at the database rather than waiting to be implemented in a service.
   */
  private async withItems(
    tx: Transaction,
    orderIds: string[],
  ): Promise<Map<string, OrderItemView[]>> {
    if (orderIds.length === 0) return new Map();

    const rows = await tx
      .select()
      .from(schema.orderItems)
      // `inArray`, not sql`... = ANY(${orderIds})`. Drizzle's sql template
      // expands a JS array into a PARAMETER LIST, so that rendered
      // `= ANY(($1))` with the uuid bound as a plain string and every real read
      // died on "malformed array literal". It went unnoticed because the only
      // test that read this path used a buyer with NO orders, and withItems
      // returns early on an empty id list - so the statement never ran.
      .where(inArray(schema.orderItems.orderId, orderIds));

    const byOrder = new Map<string, OrderItemView[]>();
    for (const row of rows) {
      const list = byOrder.get(row.orderId) ?? [];
      list.push({
        id: row.id,
        listingId: row.listingId,
        productName: row.productName,
        variantSku: row.variantSku,
        quantity: row.quantity,
        unitPrice: { amount: row.unitPriceAmount, currency: row.currency },
        lineTotal: { amount: row.lineTotalAmount, currency: row.currency },
      });
      byOrder.set(row.orderId, list);
    }
    return byOrder;
  }
}

type OrderRow = {
  id: string;
  createdAt: Date;
  orderNumber: string;
  status: string;
  tenantId: string;
  sellerName: string;
  subtotalAmount: number;
  shippingAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  placedAt: Date;
};

function toOrder(row: OrderRow, items: OrderItemView[]): OrderView {
  return {
    id: row.id,
    createdAt: row.createdAt,
    orderNumber: row.orderNumber,
    status: row.status,
    sellerId: row.tenantId,
    sellerName: row.sellerName,
    subtotal: { amount: row.subtotalAmount, currency: row.currency },
    shipping: { amount: row.shippingAmount, currency: row.currency },
    tax: { amount: row.taxAmount, currency: row.currency },
    total: { amount: row.totalAmount, currency: row.currency },
    placedAt: row.placedAt,
    items,
  };
}
