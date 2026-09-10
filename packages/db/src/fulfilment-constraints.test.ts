import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index.js';
import { makeWithTenant } from './tenant-context.js';

/**
 * The fulfilment invariants that live in the DATABASE rather than in a service.
 *
 * Two of them:
 *
 *   - `order_events` is append-only, and the REVOKE is what makes it so. The
 *     GRANT in migration 0001 already handed nexmarket_app all four verbs on
 *     every future table, so a narrower GRANT would read like a restriction and
 *     remove nothing. ADR 0016 paid for that lesson on ledger_entries.
 *   - shipped + cancelled <= ordered, per order item. Not a CHECK, because the
 *     invariant spans rows in another table; a DEFERRED constraint trigger,
 *     because a multi-line shipment is legitimately unbalanced between
 *     statements exactly as a ledger transaction is.
 *
 * FulfilmentService also checks before it writes, with the conditional-UPDATE
 * shape from ADR 0017. That is the check. This is the backstop, and it exists
 * because "the service always checks first" is a claim no test can make about a
 * service that has not been written yet.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

let container: StartedPostgreSqlContainer;
let appPool: Pool;
let withTenant: ReturnType<typeof makeWithTenant>;

let orgId: string;
let orderId: string;
let orderItemId: string;
let shipmentId: string;

const ctx = { tenantId: null, userId: null, isAdmin: true } as const;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();

  const ownerPool = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
  const ownerDb = drizzle(ownerPool, { schema });

  await ownerDb.execute(sql`CREATE ROLE nexmarket_app WITH LOGIN PASSWORD 'probe' NOBYPASSRLS`);
  await migrate(drizzle(ownerPool), { migrationsFolder });

  await ownerDb.insert(schema.countries).values({ code: 'BD', name: 'Bangladesh', dialCode: '+880' });
  await ownerDb
    .insert(schema.currencies)
    .values({ code: 'BDT', name: 'Bangladeshi Taka', symbol: 'Tk' });

  const orgs = await ownerDb
    .insert(schema.organisations)
    .values({
      slug: 'fulc-a',
      legalName: 'A Ltd',
      displayName: 'A',
      countryCode: 'BD',
      defaultCurrency: 'BDT',
    })
    .returning({ id: schema.organisations.id });
  const org = orgs[0]?.id;
  if (org === undefined) throw new Error('fixture setup failed');
  orgId = org;

  const users = await ownerDb
    .insert(schema.users)
    .values({ email: 'ful-constraints-buyer@example.test', displayName: 'Buyer' })
    .returning({ id: schema.users.id });
  const buyer = users[0]?.id;
  if (buyer === undefined) throw new Error('fixture setup failed');

  const categories = await ownerDb
    .insert(schema.categories)
    .values({ slug: 'fulc-widgets', name: 'Widgets', path: 'fulc_widgets' })
    .returning({ id: schema.categories.id });
  const categoryId = categories[0]?.id;
  if (categoryId === undefined) throw new Error('fixture setup failed');

  const products = await ownerDb
    .insert(schema.products)
    .values({ slug: 'fulc-widget', name: 'Widget', categoryId, status: 'ACTIVE' })
    .returning({ id: schema.products.id });
  const productId = products[0]?.id;
  if (productId === undefined) throw new Error('fixture setup failed');

  const variants = await ownerDb
    .insert(schema.productVariants)
    .values({ productId, sku: 'FULC-1', name: 'Default' })
    .returning({ id: schema.productVariants.id });
  const variantId = variants[0]?.id;
  if (variantId === undefined) throw new Error('fixture setup failed');

  const listings = await ownerDb
    .insert(schema.listings)
    .values({
      tenantId: orgId,
      variantId,
      status: 'ACTIVE',
      priceAmount: 1000,
      priceCurrency: 'BDT',
      availableStock: 10,
    })
    .returning({ id: schema.listings.id });
  const listingId = listings[0]?.id;
  if (listingId === undefined) throw new Error('fixture setup failed');

  const intents = await ownerDb
    .insert(schema.paymentIntents)
    .values({
      buyerUserId: buyer,
      provider: 'mock',
      amountTotal: 3000,
      currency: 'BDT',
      idempotencyKey: 'ful-constraints-fixture',
    })
    .returning({ id: schema.paymentIntents.id });
  const intentId = intents[0]?.id;
  if (intentId === undefined) throw new Error('fixture setup failed');

  const orders = await ownerDb
    .insert(schema.orders)
    .values({
      tenantId: orgId,
      buyerUserId: buyer,
      paymentIntentId: intentId,
      orderNumber: 'FULC-1',
      status: 'ACCEPTED',
      subtotalAmount: 3000,
      totalAmount: 3000,
      currency: 'BDT',
      shippingAddress: { city: 'Dhaka' },
    })
    .returning({ id: schema.orders.id });
  const order = orders[0]?.id;
  if (order === undefined) throw new Error('fixture setup failed');
  orderId = order;

  // THREE units. Every over-shipment case below is measured against this.
  const items = await ownerDb
    .insert(schema.orderItems)
    .values({
      tenantId: orgId,
      orderId,
      listingId,
      productName: 'Widget',
      variantSku: 'FULC-1',
      unitPriceAmount: 1000,
      quantity: 3,
      lineTotalAmount: 3000,
      commissionBps: 1000,
      commissionAmount: 300,
      currency: 'BDT',
    })
    .returning({ id: schema.orderItems.id });
  const item = items[0]?.id;
  if (item === undefined) throw new Error('fixture setup failed');
  orderItemId = item;

  const shipments = await ownerDb
    .insert(schema.shipments)
    .values({
      tenantId: orgId,
      orderId,
      shipmentNumber: 'FULC-SHP-1',
      releaseAmount: 1000,
      releaseCommission: 100,
      currency: 'BDT',
      idempotencyKey: 'ful-constraints-ship',
    })
    .returning({ id: schema.shipments.id });
  const shipment = shipments[0]?.id;
  if (shipment === undefined) throw new Error('fixture setup failed');
  shipmentId = shipment;

  await ownerDb.insert(schema.orderEvents).values({
    tenantId: orgId,
    orderId,
    buyerUserId: buyer,
    type: 'PLACED',
    actor: 'SYSTEM',
  });

  await ownerPool.end();

  const uri = new URL(container.getConnectionUri());
  uri.username = 'nexmarket_app';
  uri.password = 'probe';
  appPool = new Pool({ connectionString: uri.toString(), max: 5 });
  withTenant = makeWithTenant(drizzle(appPool, { schema }));
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await container?.stop();
});


/**
 * Drizzle wraps the pg error, so the SQLSTATE is on `.cause`. Same helpers as
 * `ledger-constraints.test.ts` and for the reason stated there: asserting the
 * SQLSTATE is what makes these specific. Without it, "the write threw" passes
 * for a typo in the SQL as readily as for the invariant doing its job - and
 * this file's first draft did exactly that, matching on a message that never
 * reaches the top-level error.
 */
async function causeOf(
  attempt: Promise<unknown>,
): Promise<{ code?: string; message?: string }> {
  const error = await attempt.then(
    () => {
      throw new Error('expected the write to be refused, but it succeeded');
    },
    (e: unknown) => e,
  );
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  return cause ?? {};
}

/** A trigger RAISE arrives as SQLSTATE P0001 with the message on .cause. */
async function expectRaise(attempt: Promise<unknown>, pattern: RegExp): Promise<void> {
  const cause = await causeOf(attempt);
  expect(cause.code).toBe('P0001');
  expect(cause.message).toMatch(pattern);
}

/** Privilege refusals are SQLSTATE 42501. */
async function expectPermissionDenied(attempt: Promise<unknown>, table: string): Promise<void> {
  const cause = await causeOf(attempt);
  expect(cause.code).toBe('42501');
  expect(cause.message).toMatch(new RegExp(`permission denied for table ${table}`, 'i'));
}

/** Reset shipped and cancelled units between cases. */
async function clearCoverage(): Promise<void> {
  await withTenant(ctx, async (tx) => {
    await tx.execute(sql`DELETE FROM shipment_items WHERE order_item_id = ${orderItemId}`);
    await tx.execute(sql`UPDATE order_items SET cancelled_quantity = 0 WHERE id = ${orderItemId}`);
  });
}

describe('order_events is append-only', () => {
  it('allows INSERT', async () => {
    const rows = await withTenant(ctx, (tx) =>
      tx.execute(sql`
        INSERT INTO order_events (tenant_id, order_id, buyer_user_id, type, actor)
        SELECT ${orgId}::uuid, ${orderId}::uuid, o.buyer_user_id, 'ACCEPTED', 'SELLER'
          FROM orders o WHERE o.id = ${orderId}
      `),
    );
    expect(rows.rowCount).toBe(1);
  });

  it('refuses UPDATE with SQLSTATE 42501', async () => {
    await expectPermissionDenied(
      withTenant(ctx, (tx) => tx.execute(sql`UPDATE order_events SET type = 'PAID'`)),
      'order_events',
    );
  });

  it('refuses DELETE with SQLSTATE 42501', async () => {
    await expectPermissionDenied(
      withTenant(ctx, (tx) => tx.execute(sql`DELETE FROM order_events`)),
      'order_events',
    );
  });
});

describe('shipped + cancelled <= ordered', () => {
  it('accepts a shipment that fits', async () => {
    await clearCoverage();
    await withTenant(ctx, (tx) =>
      tx.insert(schema.shipmentItems).values({ tenantId: orgId, shipmentId, orderItemId, quantity: 3 }),
    );
    const rows = await withTenant(ctx, (tx) =>
      tx.execute<{ total: string }>(
        sql`SELECT COALESCE(SUM(quantity), 0) AS total FROM shipment_items WHERE order_item_id = ${orderItemId}`,
      ),
    );
    expect(Number.parseInt(rows.rows[0]?.total ?? '0', 10)).toBe(3);
  });

  it('lets the inserts succeed and fails the COMMIT when a line over-ships', async () => {
    await clearCoverage();
    // DEFERRABLE INITIALLY DEFERRED, so this is the shape of the assertion:
    // both inserts of 2 against a line of 3 SUCCEED, and the transaction dies
    // at commit. A non-deferred trigger would reject the second statement and
    // could not express a multi-line shipment at all.
    await expectRaise(
      withTenant(ctx, async (tx) => {
        await tx
          .insert(schema.shipmentItems)
          .values({ tenantId: orgId, shipmentId, orderItemId, quantity: 2 });
        await tx
          .insert(schema.shipmentItems)
          .values({ tenantId: orgId, shipmentId, orderItemId, quantity: 2 });
      }),
      /over-ships/i,
    );
  });

  it('counts cancelled units against the same budget', async () => {
    await clearCoverage();
    await withTenant(ctx, (tx) =>
      tx.execute(sql`UPDATE order_items SET cancelled_quantity = 2 WHERE id = ${orderItemId}`),
    );
    await expectRaise(
      withTenant(ctx, (tx) =>
        tx
          .insert(schema.shipmentItems)
          .values({ tenantId: orgId, shipmentId, orderItemId, quantity: 2 }),
      ),
      /over-ships/i,
    );
  });

  it('refuses cancelling units that already shipped', async () => {
    await clearCoverage();
    await withTenant(ctx, (tx) =>
      tx.insert(schema.shipmentItems).values({ tenantId: orgId, shipmentId, orderItemId, quantity: 2 }),
    );
    // The other direction. Without a trigger on order_items, a seller could
    // cancel a line out from under a parcel already with a courier.
    await expectRaise(
      withTenant(ctx, (tx) =>
        tx.execute(sql`UPDATE order_items SET cancelled_quantity = 2 WHERE id = ${orderItemId}`),
      ),
      /over-ships/i,
    );
  });

  it('allows cancelling exactly the units that remain', async () => {
    await clearCoverage();
    await withTenant(ctx, (tx) =>
      tx.insert(schema.shipmentItems).values({ tenantId: orgId, shipmentId, orderItemId, quantity: 2 }),
    );
    await withTenant(ctx, (tx) =>
      tx.execute(sql`UPDATE order_items SET cancelled_quantity = 1 WHERE id = ${orderItemId}`),
    );
    const rows = await withTenant(ctx, (tx) =>
      tx.execute<{ cancelled: number }>(
        sql`SELECT cancelled_quantity AS cancelled FROM order_items WHERE id = ${orderItemId}`,
      ),
    );
    expect(rows.rows[0]?.cancelled).toBe(1);
  });
});
