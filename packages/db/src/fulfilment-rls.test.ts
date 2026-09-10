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
 * Phase 5 fulfilment: the gated second-policy pattern's FOURTH, FIFTH and SIXTH
 * appearances, on three tables at once.
 *
 * The shape is the one `orders-rls.test.ts` establishes and is worth restating,
 * because it is the thing that has broken three times:
 *
 *   - a SELLER sends x-tenant-id, so `tenant_isolation` applies and they see
 *     their own parcels and nobody else's;
 *   - a BUYER sends no tenant, so the gated `own_*` policy applies, keyed on
 *     app.user_id, and they see their parcels across every seller.
 *
 * Postgres ORs permissive policies, and the `IS NULL` gate is what keeps the
 * two apart. The mutation check was run, and its result is worth stating
 * precisely rather than tidily: removing all three gates turns exactly ONE test
 * red, `order_events`. The two shipment policies reach the buyer through an
 * EXISTS on `orders`, and that subquery is itself under RLS - with a tenant
 * selected it cannot see another seller's order, so the parcel fails the EXISTS
 * with or without the gate.
 *
 * They keep their gates anyway. Their safety is currently DERIVED from the
 * orders policy rather than stated in their own, which is exactly the implicit
 * coupling that stops holding the day someone edits a different table.
 *
 * All three buyer policies are FOR SELECT with no WITH CHECK, deliberately. A
 * buyer reads shipments; a buyer must never insert one. Since dispatch releases
 * a seller's payable, an inserted shipment is a claim about money.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

let container: StartedPostgreSqlContainer;
let appPool: Pool;
let withTenant: ReturnType<typeof makeWithTenant>;

let orgA: string;
let orgB: string;
let buyer: string;
let stranger: string;
let orderA: string;
let orderItemA: string;
let shipmentA: string;

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
      { slug: 'ful-a', legalName: 'A Ltd', displayName: 'A', countryCode: 'BD', defaultCurrency: 'BDT' },
      { slug: 'ful-b', legalName: 'B Ltd', displayName: 'B', countryCode: 'BD', defaultCurrency: 'BDT' },
    ])
    .returning({ id: schema.organisations.id });
  const [a, b] = orgs;
  if (!a || !b) throw new Error('fixture setup failed');
  orgA = a.id;
  orgB = b.id;

  const users = await ownerDb
    .insert(schema.users)
    .values([
      { email: 'ful-rls-buyer@example.test', displayName: 'Buyer' },
      { email: 'ful-rls-stranger@example.test', displayName: 'Stranger' },
    ])
    .returning({ id: schema.users.id });
  const [one, two] = users;
  if (!one || !two) throw new Error('fixture setup failed');
  buyer = one.id;
  stranger = two.id;

  const categories = await ownerDb
    .insert(schema.categories)
    .values({ slug: 'ful-widgets', name: 'Widgets', path: 'ful_widgets' })
    .returning({ id: schema.categories.id });
  const categoryId = categories[0]?.id;
  if (categoryId === undefined) throw new Error('fixture setup failed');

  const products = await ownerDb
    .insert(schema.products)
    .values({ slug: 'ful-widget', name: 'Widget', categoryId, status: 'ACTIVE' })
    .returning({ id: schema.products.id });
  const productId = products[0]?.id;
  if (productId === undefined) throw new Error('fixture setup failed');

  const variants = await ownerDb
    .insert(schema.productVariants)
    .values({ productId, sku: 'FUL-1', name: 'Default' })
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

  const intents = await ownerDb
    .insert(schema.paymentIntents)
    .values({
      buyerUserId: buyer,
      provider: 'mock',
      amountTotal: 1900,
      currency: 'BDT',
      idempotencyKey: 'ful-rls-fixture',
    })
    .returning({ id: schema.paymentIntents.id });
  const intentId = intents[0]?.id;
  if (intentId === undefined) throw new Error('fixture setup failed');

  // One basket, two sellers, two orders - so "across every seller" is a real
  // claim rather than one row seen twice.
  const placed = await ownerDb
    .insert(schema.orders)
    .values([
      {
        tenantId: orgA,
        buyerUserId: buyer,
        paymentIntentId: intentId,
        orderNumber: 'FUL-RLS-A',
        status: 'ACCEPTED',
        subtotalAmount: 1000,
        totalAmount: 1000,
        currency: 'BDT',
        shippingAddress: { city: 'Dhaka' },
      },
      {
        tenantId: orgB,
        buyerUserId: buyer,
        paymentIntentId: intentId,
        orderNumber: 'FUL-RLS-B',
        status: 'ACCEPTED',
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

  const items = await ownerDb
    .insert(schema.orderItems)
    .values([
      {
        tenantId: orgA,
        orderId: rowA,
        listingId: listingA,
        productName: 'Widget',
        variantSku: 'FUL-1',
        unitPriceAmount: 1000,
        quantity: 3,
        lineTotalAmount: 3000,
        commissionBps: 1000,
        commissionAmount: 300,
        currency: 'BDT',
      },
      {
        tenantId: orgB,
        orderId: rowB,
        listingId: listingB,
        productName: 'Widget',
        variantSku: 'FUL-1',
        unitPriceAmount: 900,
        quantity: 1,
        lineTotalAmount: 900,
        commissionBps: 1000,
        commissionAmount: 90,
        currency: 'BDT',
      },
    ])
    .returning({ id: schema.orderItems.id, tenantId: schema.orderItems.tenantId });
  const itemA = items.find((i) => i.tenantId === orgA)?.id;
  const itemB = items.find((i) => i.tenantId === orgB)?.id;
  if (!itemA || !itemB) throw new Error('fixture setup failed');
  orderItemA = itemA;

  const shipped = await ownerDb
    .insert(schema.shipments)
    .values([
      {
        tenantId: orgA,
        orderId: rowA,
        shipmentNumber: 'SHP-RLS-A',
        releaseAmount: 1000,
        releaseCommission: 100,
        currency: 'BDT',
        idempotencyKey: 'ful-rls-ship-a',
      },
      {
        tenantId: orgB,
        orderId: rowB,
        shipmentNumber: 'SHP-RLS-B',
        releaseAmount: 900,
        releaseCommission: 90,
        currency: 'BDT',
        idempotencyKey: 'ful-rls-ship-b',
      },
    ])
    .returning({ id: schema.shipments.id, tenantId: schema.shipments.tenantId });
  const shipA = shipped.find((s) => s.tenantId === orgA)?.id;
  const shipB = shipped.find((s) => s.tenantId === orgB)?.id;
  if (!shipA || !shipB) throw new Error('fixture setup failed');
  shipmentA = shipA;

  await ownerDb.insert(schema.shipmentItems).values([
    { tenantId: orgA, shipmentId: shipA, orderItemId: itemA, quantity: 1 },
    { tenantId: orgB, shipmentId: shipB, orderItemId: itemB, quantity: 1 },
  ]);

  await ownerDb.insert(schema.orderEvents).values([
    { tenantId: orgA, orderId: rowA, buyerUserId: buyer, type: 'PLACED', actor: 'SYSTEM' },
    { tenantId: orgB, orderId: rowB, buyerUserId: buyer, type: 'PLACED', actor: 'SYSTEM' },
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

const asSeller = (tenantId: string, userId: string | null = null) => ({
  tenantId,
  userId,
  isAdmin: false,
});
const asBuyer = (userId: string) => ({ tenantId: null, userId, isAdmin: false });
const asNobody = { tenantId: null, userId: null, isAdmin: false };

describe('shipments', () => {
  it('shows a seller only their own parcels', async () => {
    const rows = await withTenant(asSeller(orgA), (tx) => tx.select().from(schema.shipments));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(orgA);
  });

  it('does NOT widen a seller read when a user id is also present', async () => {
    // THE MUTATION CHECK. Delete the IS NULL gate from own_shipments and this
    // returns 2 - the bug fixed by migrations 0006, 0008 and 0012.
    const rows = await withTenant(asSeller(orgA, buyer), (tx) =>
      tx.select().from(schema.shipments),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(orgA);
  });

  it('shows a buyer their parcels across every seller', async () => {
    const rows = await withTenant(asBuyer(buyer), (tx) => tx.select().from(schema.shipments));
    expect(rows).toHaveLength(2);
  });

  it('shows another buyer nothing', async () => {
    const rows = await withTenant(asBuyer(stranger), (tx) => tx.select().from(schema.shipments));
    expect(rows).toHaveLength(0);
  });

  it('returns ZERO rows with no context at all, never all rows', async () => {
    const rows = await withTenant(asNobody, (tx) => tx.select().from(schema.shipments));
    expect(rows).toHaveLength(0);
  });

  it('does not let a buyer insert a parcel', async () => {
    await expect(
      withTenant(asBuyer(buyer), (tx) =>
        tx.insert(schema.shipments).values({
          tenantId: orgA,
          orderId: orderA,
          shipmentNumber: 'SHP-RLS-FORGED',
          releaseAmount: 1,
          releaseCommission: 0,
          currency: 'BDT',
          idempotencyKey: 'ful-rls-forged',
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('shipment_items', () => {
  it('shows a seller only their own lines', async () => {
    const rows = await withTenant(asSeller(orgA), (tx) => tx.select().from(schema.shipmentItems));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(orgA);
  });

  it('does NOT widen a seller read when a user id is also present', async () => {
    const rows = await withTenant(asSeller(orgA, buyer), (tx) =>
      tx.select().from(schema.shipmentItems),
    );
    expect(rows).toHaveLength(1);
  });

  it('shows a buyer their lines across every seller', async () => {
    const rows = await withTenant(asBuyer(buyer), (tx) => tx.select().from(schema.shipmentItems));
    expect(rows).toHaveLength(2);
  });

  it('returns ZERO rows with no context at all', async () => {
    const rows = await withTenant(asNobody, (tx) => tx.select().from(schema.shipmentItems));
    expect(rows).toHaveLength(0);
  });

  it('does not let a buyer insert a line', async () => {
    await expect(
      withTenant(asBuyer(buyer), (tx) =>
        tx
          .insert(schema.shipmentItems)
          .values({ tenantId: orgA, shipmentId: shipmentA, orderItemId: orderItemA, quantity: 1 }),
      ),
    ).rejects.toThrow();
  });
});

describe('order_events', () => {
  it('shows a seller only their own events', async () => {
    const rows = await withTenant(asSeller(orgA), (tx) => tx.select().from(schema.orderEvents));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(orgA);
  });

  it('does NOT widen a seller read when a user id is also present', async () => {
    const rows = await withTenant(asSeller(orgA, buyer), (tx) =>
      tx.select().from(schema.orderEvents),
    );
    expect(rows).toHaveLength(1);
  });

  it('shows a buyer their timeline across every seller', async () => {
    const rows = await withTenant(asBuyer(buyer), (tx) => tx.select().from(schema.orderEvents));
    expect(rows).toHaveLength(2);
  });

  it('returns ZERO rows with no context at all', async () => {
    const rows = await withTenant(asNobody, (tx) => tx.select().from(schema.orderEvents));
    expect(rows).toHaveLength(0);
  });

  it('does not let a buyer write their own history', async () => {
    await expect(
      withTenant(asBuyer(buyer), (tx) =>
        tx.insert(schema.orderEvents).values({
          tenantId: orgA,
          orderId: orderA,
          buyerUserId: buyer,
          type: 'SHIPMENT_DELIVERED',
          actor: 'BUYER',
        }),
      ),
    ).rejects.toThrow();
  });
});
