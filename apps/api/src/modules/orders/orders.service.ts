import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { type Transaction, schema, withTenant } from '@nexmarket/db';
import { decodeCursor, toPage, type Page } from '../../common/pagination.js';
import { getRequestContext } from '../../common/request-context.js';

export type OrderItemView = {
  id: string;
  listingId: string;
  productName: string;
  variantSku: string;
  quantity: number;
  unitPrice: { amount: number; currency: string };
  lineTotal: { amount: number; currency: string };
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
  /** The buyer's orders across every seller. No tenant, so `own_orders` rules. */
  async forBuyer(userId: string, limit: number, cursor?: string): Promise<Page<OrderView>> {
    return withTenant({ tenantId: null, userId, isAdmin: false }, (tx) =>
      this.page(tx, limit, cursor),
    );
  }

  async forBuyerOne(userId: string, id: string): Promise<OrderView> {
    return withTenant({ tenantId: null, userId, isAdmin: false }, (tx) => this.one(tx, id));
  }

  /** One seller's queue. The interceptor has already resolved the tenant. */
  async forSeller(limit: number, cursor?: string): Promise<Page<OrderView>> {
    return this.page(getRequestContext().tx, limit, cursor);
  }

  async forSellerOne(id: string): Promise<OrderView> {
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

  private async one(tx: Transaction, id: string): Promise<OrderView> {
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
      .where(eq(schema.orders.id, id))
      .limit(1);

    const row = rows[0];
    // A 404, not a 403. Under RLS an order that is not yours does not exist,
    // and saying "forbidden" would confirm that it does.
    if (row === undefined) throw new NotFoundException('No such order');

    const items = await this.withItems(tx, [row.id]);
    return toOrder(row, items.get(row.id) ?? []);
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
      .where(sql`${schema.orderItems.orderId} = ANY(${orderIds})`);

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
