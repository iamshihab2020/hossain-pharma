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
 * Phase 4 orders: the THIRD use of the gated second-policy pattern, and the
 * first that reads app.user_id outside the membership bootstrap.
 *
 * The shape under test:
 *
 *   - a SELLER sends x-tenant-id, so app.tenant_id is set, and must see only
 *     their own orders;
 *   - a BUYER sends no tenant at all, so app.tenant_id is empty and
 *     app.user_id identifies them, and must see THEIR orders across every
 *     seller.
 *
 * Those two requirements pull in opposite directions on one table, which is
 * exactly the situation that produced the leaks fixed by migrations 0006 and
 * 0008. The gate is what keeps them apart, and the seller-isolation case here
 * is the one that fails if it is removed.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

let container: StartedPostgreSqlContainer;
let appPool: Pool;
let withTenant: ReturnType<typeof makeWithTenant>;

let orgA: string;
let orgB: string;
let buyerOne: string;
let buyerTwo: string;
let orderA: string;
let orderB: string;

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
    .values([
      { slug: 'ord-a', legalName: 'A Ltd', displayName: 'A', countryCode: 'BD', defaultCurrency: 'BDT' },
      { slug: 'ord-b', legalName: 'B Ltd', displayName: 'B', countryCode: 'BD', defaultCurrency: 'BDT' },
    ])
    .returning({ id: schema.organisations.id });
  const [a, b] = orgs;
  if (!a || !b) throw new Error('fixture setup failed');
  orgA = a.id;
  orgB = b.id;

  const users = await ownerDb
    .insert(schema.users)
    .values([
      { email: 'orders-rls-one@example.test', displayName: 'Buyer One' },
      { email: 'orders-rls-two@example.test', displayName: 'Buyer Two' },
    ])
    .returning({ id: schema.users.id });
  const [one, two] = users;
  if (!one || !two) throw new Error('fixture setup failed');
  buyerOne = one.id;
  buyerTwo = two.id;

  const categories = await ownerDb
    .insert(schema.categories)
    .values({ slug: 'ord-widgets', name: 'Widgets', path: 'ord_widgets' })
    .returning({ id: schema.categories.id });
  const categoryId = categories[0]?.id;
  if (categoryId === undefined) throw new Error('fixture setup failed');

  const products = await ownerDb
    .insert(schema.products)
    .values({ slug: 'ord-widget', name: 'Widget', categoryId, status: 'ACTIVE' })
    .returning({ id: schema.products.id });
  const productId = products[0]?.id;
  if (productId === undefined) throw new Error('fixture setup failed');

  const variants = await ownerDb
    .insert(schema.productVariants)
    .values({ productId, sku: 'ORD-1', name: 'Default' })
    .returning({ id: schema.productVariants.id });
  const variantId = variants[0]?.id;
  if (variantId === undefined) throw new Error('fixture setup failed');

  const listings = await ownerDb
    .insert(schema.listings)
    .values([
      { tenantId: orgA, variantId, status: 'ACTIVE', priceAmount: 1000, priceCurrency: 'BDT', availableStock: 5 },
      { tenantId: orgB, variantId, status: 'ACTIVE', priceAmount: 900, priceCurrency: 'BDT', availableStock: 5 },
    ])
    .returning({ id: schema.listings.id, tenantId: schema.listings.tenantId });
  const listingA = listings.find((l) => l.tenantId === orgA)?.id;
  const listingB = listings.find((l) => l.tenantId === orgB)?.id;
  if (!listingA || !listingB) throw new Error('fixture setup failed');

  // ONE cart, TWO sellers, ONE payment intent, TWO orders - the Phase 4 shape.
  const intents = await ownerDb
    .insert(schema.paymentIntents)
    .values({
      buyerUserId: buyerOne,
      provider: 'mock',
      amountTotal: 1900,
      currency: 'BDT',
      idempotencyKey: 'orders-rls-fixture',
    })
    .returning({ id: schema.paymentIntents.id });
  const intentId = intents[0]?.id;
  if (intentId === undefined) throw new Error('fixture setup failed');

  const placed = await ownerDb
    .insert(schema.orders)
    .values([
      {
        tenantId: orgA,
        buyerUserId: buyerOne,
        paymentIntentId: intentId,
        orderNumber: 'ORD-RLS-A',
        subtotalAmount: 1000,
        totalAmount: 1000,
        currency: 'BDT',
        shippingAddress: { city: 'Dhaka' },
      },
      {
        tenantId: orgB,
        buyerUserId: buyerOne,
        paymentIntentId: intentId,
        orderNumber: 'ORD-RLS-B',
        subtotalAmount: 900,
        totalAmount: 900,
        currency: 'BDT',
        shippingAddress: { city: 'Dhaka' },
      },
    ])
    .returning({ id: schema.orders.id, tenantId: schema.orders.tenantId });
  const rowA = placed.find((o) => o.tenantId === orgA)?.id;
  const rowB = placed.find((o) => o.tenantId === orgB)?.id;
  if (!rowA || !rowB) throw new Error('fixture setup failed');
  orderA = rowA;
  orderB = rowB;

  await ownerDb.insert(schema.orderItems).values([
    {
      tenantId: orgA,
      orderId: orderA,
      listingId: listingA,
      productName: 'Widget',
      variantSku: 'ORD-1',
      unitPriceAmount: 1000,
      quantity: 1,
      lineTotalAmount: 1000,
      commissionBps: 1000,
      commissionAmount: 100,
      currency: 'BDT',
    },
    {
      tenantId: orgB,
      orderId: orderB,
      listingId: listingB,
      productName: 'Widget',
      variantSku: 'ORD-1',
      unitPriceAmount: 900,
      quantity: 1,
      lineTotalAmount: 900,
      commissionBps: 1000,
      commissionAmount: 90,
      currency: 'BDT',
    },
  ]);

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

describe('orders row-level security', () => {
  it('FORCEs row-level security, not merely enables it', async () => {
    const rows = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ relname: string; forced: boolean }>(sql`
        SELECT c.relname, c.relforcerowsecurity AS forced
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('orders', 'order_items')
      `),
    );
    expect(rows.rows).toHaveLength(2);
    // ENABLE without FORCE lets the table owner bypass every policy, and
    // migrations own these tables. It is the second of the three silent
    // failures in ADR 0003.
    for (const row of rows.rows) {
      expect(row.forced).toBe(true);
    }
  });

  it('shows a seller only their own orders', async () => {
    const rows = await withTenant({ tenantId: orgA, userId: buyerOne, isAdmin: false }, (tx) =>
      tx.select({ id: schema.orders.id }).from(schema.orders),
    );
    expect(rows.map((r) => r.id)).toEqual([orderA]);
  });

  it('shows the other seller only theirs', async () => {
    const rows = await withTenant({ tenantId: orgB, userId: buyerOne, isAdmin: false }, (tx) =>
      tx.select({ id: schema.orders.id }).from(schema.orders),
    );
    expect(rows.map((r) => r.id)).toEqual([orderB]);
  });

  /**
   * THE MUTATION TARGET.
   *
   * `own_orders` is gated on no tenant being selected. Delete that line from
   * migration 0012 and this is the test that fails: with the gate gone, seller
   * A's tenant-scoped read ALSO matches own_orders and returns order B, because
   * Postgres ORs permissive policies. That is the bug from 0006 and 0008,
   * arriving for the third time.
   */
  it('does not leak another seller in through the buyer policy', async () => {
    const rows = await withTenant({ tenantId: orgA, userId: buyerOne, isAdmin: false }, (tx) =>
      tx.select({ id: schema.orders.id }).from(schema.orders),
    );
    expect(rows).toHaveLength(1);
    expect(rows.map((r) => r.id)).not.toContain(orderB);
  });

  it('shows a buyer their orders across every seller when no tenant is selected', async () => {
    const rows = await withTenant({ tenantId: null, userId: buyerOne, isAdmin: false }, (tx) =>
      tx.select({ id: schema.orders.id }).from(schema.orders),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([orderA, orderB].sort());
  });

  it('shows a different buyer nothing', async () => {
    const rows = await withTenant({ tenantId: null, userId: buyerTwo, isAdmin: false }, (tx) =>
      tx.select({ id: schema.orders.id }).from(schema.orders),
    );
    expect(rows).toEqual([]);
  });

  it('returns ZERO rows with neither a tenant nor a user, never all rows', async () => {
    const rows = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.select({ id: schema.orders.id }).from(schema.orders),
    );
    expect(rows).toEqual([]);
  });

  it('lets a platform admin see across tenants', async () => {
    const rows = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.select({ id: schema.orders.id }).from(schema.orders),
    );
    expect(rows).toHaveLength(2);
  });

  it('refuses a write attributed to another tenant', async () => {
    await expect(
      withTenant({ tenantId: orgA, userId: buyerOne, isAdmin: false }, (tx) =>
        tx.execute(sql`
          UPDATE orders SET status = 'CANCELLED' WHERE id = ${orderB}
        `),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });

    const after = await withTenant({ tenantId: orgB, userId: null, isAdmin: false }, (tx) =>
      tx.select({ status: schema.orders.status }).from(schema.orders),
    );
    expect(after[0]?.status).toBe('PENDING_PAYMENT');
  });

  /**
   * A buyer may READ their orders without a tenant. They must not be able to
   * WRITE one - own_orders is FOR SELECT and carries no WITH CHECK, which is
   * what stops a buyer inserting an order attributed to themselves outside
   * checkout.
   */
  it('refuses a buyer inserting their own order outside checkout', async () => {
    // Drizzle wraps driver errors, so the SQLSTATE lives on .cause and never on
    // error.message - the same trap catalogue-rls.test.ts documents.
    const error = await withTenant({ tenantId: null, userId: buyerOne, isAdmin: false }, (tx) =>
        tx.execute(sql`
          INSERT INTO orders (tenant_id, buyer_user_id, payment_intent_id, order_number,
                              subtotal_amount, total_amount, currency, shipping_address)
          SELECT ${orgA}::uuid, ${buyerOne}::uuid, payment_intent_id, 'ORD-RLS-FORGED',
                 1, 1, 'BDT', '{}'::jsonb
          FROM orders LIMIT 1
        `),
    ).then(
      () => {
        throw new Error('expected the forged insert to be refused, but it succeeded');
      },
      (e: unknown) => e,
    );
    const cause = (error as { cause?: unknown }).cause as
      | { code?: string; message?: string }
      | undefined;
    expect(cause?.code).toBe('42501');
    expect(cause?.message).toMatch(/row-level security/i);
  });
});

describe('order_items row-level security', () => {
  it('shows a seller only their own items', async () => {
    const rows = await withTenant({ tenantId: orgA, userId: buyerOne, isAdmin: false }, (tx) =>
      tx.select({ id: schema.orderItems.id }).from(schema.orderItems),
    );
    expect(rows).toHaveLength(1);
  });

  it('shows a buyer the items of both their orders', async () => {
    const rows = await withTenant({ tenantId: null, userId: buyerOne, isAdmin: false }, (tx) =>
      tx.select({ id: schema.orderItems.id }).from(schema.orderItems),
    );
    expect(rows).toHaveLength(2);
  });

  it('shows a different buyer none of them', async () => {
    const rows = await withTenant({ tenantId: null, userId: buyerTwo, isAdmin: false }, (tx) =>
      tx.select({ id: schema.orderItems.id }).from(schema.orderItems),
    );
    expect(rows).toEqual([]);
  });
});
