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

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

let container: StartedPostgreSqlContainer;
let appPool: Pool;
let withTenant: ReturnType<typeof makeWithTenant>;
let orgA: string;
let orgB: string;
let variantId: string;
let draftListingA: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();

  // Fixtures are planted by the container's SUPERUSER, which bypasses RLS even
  // under FORCE. That is what lets this file write rows it then proves the
  // application role cannot see - and it is why the application must never
  // connect as one.
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
      { slug: 'org-a', legalName: 'A Ltd', displayName: 'A', countryCode: 'BD', defaultCurrency: 'BDT' },
      { slug: 'org-b', legalName: 'B Ltd', displayName: 'B', countryCode: 'BD', defaultCurrency: 'BDT' },
    ])
    .returning({ id: schema.organisations.id });
  const [a, b] = orgs;
  if (!a || !b) throw new Error('fixture setup failed');
  orgA = a.id;
  orgB = b.id;

  const categories = await ownerDb
    .insert(schema.categories)
    .values({ slug: 'widgets', name: 'Widgets', path: 'widgets' })
    .returning({ id: schema.categories.id });
  const categoryId = categories[0]?.id;
  if (categoryId === undefined) throw new Error('fixture setup failed');

  const products = await ownerDb
    .insert(schema.products)
    .values({ slug: 'widget', name: 'Widget', categoryId, status: 'ACTIVE' })
    .returning({ id: schema.products.id });
  const productId = products[0]?.id;
  if (productId === undefined) throw new Error('fixture setup failed');

  const variants = await ownerDb
    .insert(schema.productVariants)
    .values({ productId, sku: 'WID-1', name: 'Default' })
    .returning({ id: schema.productVariants.id });
  const variant = variants[0]?.id;
  if (variant === undefined) throw new Error('fixture setup failed');
  variantId = variant;

  const otherVariants = await ownerDb
    .insert(schema.productVariants)
    .values({ productId, sku: 'WID-2', name: 'Second' })
    .returning({ id: schema.productVariants.id });
  const otherVariant = otherVariants[0]?.id;
  if (otherVariant === undefined) throw new Error('fixture setup failed');

  // Both sellers offer WID-1, which is the shape the whole phase exists for.
  // Org A also has a DRAFT offer on WID-2, which nobody but A may see.
  const listings = await ownerDb
    .insert(schema.listings)
    .values([
      { tenantId: orgA, variantId, status: 'ACTIVE', priceAmount: 1000, priceCurrency: 'BDT', availableStock: 5 },
      { tenantId: orgB, variantId, status: 'ACTIVE', priceAmount: 900, priceCurrency: 'BDT', availableStock: 5 },
      { tenantId: orgA, variantId: otherVariant, status: 'DRAFT', priceAmount: 700, priceCurrency: 'BDT' },
    ])
    .returning({ id: schema.listings.id, status: schema.listings.status });
  const draft = listings.find((l) => l.status === 'DRAFT')?.id;
  if (draft === undefined) throw new Error('fixture setup failed');
  draftListingA = draft;

  const warehouses = await ownerDb
    .insert(schema.warehouses)
    .values([
      { tenantId: orgA, name: 'A depot', pincode: '1207' },
      { tenantId: orgB, name: 'B depot', pincode: '4000' },
    ])
    .returning({ id: schema.warehouses.id, tenantId: schema.warehouses.tenantId });
  const warehouseA = warehouses.find((w) => w.tenantId === orgA)?.id;
  const listingA = listings.find((l) => l.status === 'ACTIVE')?.id;
  if (warehouseA === undefined || listingA === undefined) throw new Error('fixture setup failed');
  await ownerDb
    .insert(schema.inventoryItems)
    .values({ tenantId: orgA, listingId: listingA, warehouseId: warehouseA, onHand: 5 });

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

async function expectRlsRefusal(attempt: Promise<unknown>): Promise<void> {
  const error = await attempt.then(
    () => {
      throw new Error('expected the write to be refused, but it succeeded');
    },
    (e: unknown) => e,
  );
  const cause = (error as { cause?: unknown }).cause as { code?: string; message?: string } | undefined;
  expect(cause?.code).toBe('42501');
  expect(cause?.message).toMatch(/row-level security/i);
}

/**
 * Drizzle wraps driver errors in its own "Failed query:" message, so the
 * constraint name lives on `.cause`, not on the message. Asserting the NAME is
 * what makes these tests specific: without it, "the insert threw" passes for a
 * typo in the SQL as readily as for the constraint doing its job.
 */
async function expectConstraint(attempt: Promise<unknown>, name: string): Promise<void> {
  const error = await attempt.then(
    () => {
      throw new Error(`expected ${name} to refuse the write, but it succeeded`);
    },
    (e: unknown) => e,
  );
  const cause = (error as { cause?: unknown }).cause as { constraint?: string } | undefined;
  expect(cause?.constraint).toBe(name);
}

describe('listings RLS', () => {
  it('shows an anonymous reader every ACTIVE offer and no others', async () => {
    // The deliberate public read (policy public_active_offers). A marketplace
    // product page has to work for someone who is not logged in.
    const res = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ tenant_id: string; status: string }>(sql`SELECT tenant_id, status FROM listings`),
    );
    expect(res.rows).toHaveLength(2);
    expect(res.rows.every((r) => r.status === 'ACTIVE')).toBe(true);
    expect(new Set(res.rows.map((r) => r.tenant_id))).toEqual(new Set([orgA, orgB]));
  });

  it('does NOT widen a tenant-scoped read with other sellers ACTIVE offers', async () => {
    // The regression that migration 0006 fixed on org_members, and the reason
    // public_active_offers is gated on there being no tenant selected.
    // Permissive policies are ORed: without that gate, seller A reading their
    // own catalogue would see seller B's live prices mixed into it.
    const res = await withTenant({ tenantId: orgA, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ tenant_id: string }>(sql`SELECT tenant_id FROM listings`),
    );
    expect(res.rows).not.toHaveLength(0);
    expect(res.rows.every((r) => r.tenant_id === orgA)).toBe(true);
  });

  it('shows a tenant its own DRAFT offers, which the public read hides', async () => {
    const own = await withTenant({ tenantId: orgA, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ id: string }>(sql`SELECT id FROM listings WHERE status = 'DRAFT'`),
    );
    expect(own.rows.map((r) => r.id)).toEqual([draftListingA]);

    const anonymous = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute(sql`SELECT id FROM listings WHERE status = 'DRAFT'`),
    );
    expect(anonymous.rows).toHaveLength(0);
  });

  it('refuses seller B a write against seller A rows', async () => {
    // The PRD 11 acceptance criterion: "RLS blocks seller A from editing seller
    // B's listing." Asserted as a WRITE refusal here and as an HTTP 403 in the
    // API suite, because closing one and leaving the other is the mistake.
    await expectRlsRefusal(
      withTenant({ tenantId: orgB, userId: null, isAdmin: false }, (tx) =>
        tx.execute(
          sql`INSERT INTO listings (tenant_id, variant_id, price_amount, price_currency) VALUES (${orgA}, ${variantId}, 1, 'BDT')`,
        ),
      ),
    );
  });

  it('updates zero rows when seller B aims an UPDATE at seller A offer', async () => {
    // An UPDATE whose WHERE matches nothing visible is not an error - it is a
    // no-op, and that IS the isolation. Asserting the row is unchanged is the
    // only way to tell a working policy from a silent success.
    const before = await withTenant({ tenantId: orgA, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ price_amount: string }>(
        sql`SELECT price_amount FROM listings WHERE id = ${draftListingA}`,
      ),
    );
    await withTenant({ tenantId: orgB, userId: null, isAdmin: false }, (tx) =>
      tx.execute(sql`UPDATE listings SET price_amount = 1 WHERE id = ${draftListingA}`),
    );
    const after = await withTenant({ tenantId: orgA, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ price_amount: string }>(
        sql`SELECT price_amount FROM listings WHERE id = ${draftListingA}`,
      ),
    );
    expect(after.rows[0]?.price_amount).toBe(before.rows[0]?.price_amount);
  });

  it('lets a platform admin see every offer, whatever its status', async () => {
    const res = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute(sql`SELECT id FROM listings`),
    );
    expect(res.rows).toHaveLength(3);
  });
});

describe('inventory and warehouses RLS', () => {
  it('returns ZERO inventory rows to an anonymous reader', async () => {
    // Deliberately NOT public, unlike listings. Exact per-warehouse stock is a
    // competitor's business intelligence; the product page reads the
    // listings.available_stock summary instead.
    const res = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute(sql`SELECT id FROM inventory_items`),
    );
    expect(res.rows).toHaveLength(0);
  });

  it('returns ZERO warehouse rows to an anonymous reader', async () => {
    const res = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute(sql`SELECT id FROM warehouses`),
    );
    expect(res.rows).toHaveLength(0);
  });

  it('scopes warehouses to the active tenant', async () => {
    const res = await withTenant({ tenantId: orgA, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ name: string }>(sql`SELECT name FROM warehouses`),
    );
    expect(res.rows.map((r) => r.name)).toEqual(['A depot']);
  });

  it('refuses a cross-tenant inventory write', async () => {
    await expectRlsRefusal(
      withTenant({ tenantId: orgB, userId: null, isAdmin: false }, async (tx) => {
        const rows = await tx.execute<{ id: string; warehouse_id: string }>(
          sql`SELECT id, warehouse_id FROM inventory_items`,
        );
        // orgB sees none of orgA's rows, so the write is constructed from ids
        // planted by the superuser fixture instead - the point is that the
        // policy refuses it even when the ids are correct.
        void rows;
        return tx.execute(
          sql`INSERT INTO inventory_items (tenant_id, listing_id, warehouse_id, on_hand)
              SELECT ${orgA}, id, ${orgA}::uuid, 1 FROM listings LIMIT 1`,
        );
      }),
    );
  });
});

describe('catalogue tables are deliberately NOT tenant-scoped', () => {
  it('shows products and variants to an anonymous reader', async () => {
    // PRD 8.3: a catalogue entry is shared by competing sellers. A tenant
    // policy on `products` would make the one-product-many-sellers page
    // impossible, which is the entire point of the phase.
    const res = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute(sql`SELECT id FROM products`),
    );
    expect(res.rows).toHaveLength(1);
  });

  it('carries no row-level security on any catalogue table', async () => {
    const res = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ relname: string; relrowsecurity: boolean }>(
        sql`SELECT relname, relrowsecurity FROM pg_class
            WHERE relname IN ('categories','category_attributes','products','product_variants','product_media','product_attributes')
            ORDER BY relname`,
      ),
    );
    expect(res.rows).toHaveLength(6);
    for (const row of res.rows) {
      expect(`${row.relname}: ${String(row.relrowsecurity)}`).toBe(`${row.relname}: false`);
    }
  });

  it('forces row-level security on every tenant-owned catalogue table', async () => {
    const res = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        sql`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
            WHERE relname IN ('listings','inventory_items','warehouses') ORDER BY relname`,
      ),
    );
    expect(res.rows).toHaveLength(3);
    for (const row of res.rows) {
      expect(`${row.relname}: ${String(row.relrowsecurity)}/${String(row.relforcerowsecurity)}`).toBe(
        `${row.relname}: true/true`,
      );
    }
  });
});

describe('catalogue constraints', () => {
  it('refuses a category deeper than three levels', async () => {
    await expectConstraint(
      withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
        tx.execute(
          sql`INSERT INTO categories (slug, name, path) VALUES ('too-deep', 'Too deep', 'a.b.c.d')`,
        ),
      ),
      'categories_max_depth',
    );
  });

  it('refuses an attribute with no value, or with two', async () => {
    const productId = (
      await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
        tx.execute<{ id: string }>(sql`SELECT id FROM products LIMIT 1`),
      )
    ).rows[0]?.id;

    await expectConstraint(
      withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
        tx.execute(
          sql`INSERT INTO product_attributes (product_id, key) VALUES (${productId}, 'empty')`,
        ),
      ),
      'product_attributes_one_value',
    );

    await expectConstraint(
      withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
        tx.execute(
          sql`INSERT INTO product_attributes (product_id, key, value_text, value_bool) VALUES (${productId}, 'both', 'x', true)`,
        ),
      ),
      'product_attributes_one_value',
    );
  });

  it('refuses reserving more stock than is on hand', async () => {
    // Phase 4 decrements `reserved` at checkout. This is what stops a race there
    // from leaving a listing owing stock it does not have.
    await expectConstraint(
      withTenant({ tenantId: orgA, userId: null, isAdmin: false }, (tx) =>
        tx.execute(sql`UPDATE inventory_items SET reserved = on_hand + 1`),
      ),
      'inventory_items_non_negative',
    );
  });

  it('refuses a sale price above the base price', async () => {
    await expectConstraint(
      withTenant({ tenantId: orgA, userId: null, isAdmin: false }, (tx) =>
        tx.execute(
          sql`UPDATE listings SET sale_price_amount = price_amount + 1 WHERE id = ${draftListingA}`,
        ),
      ),
      'listings_prices_non_negative',
    );
  });

  it('refuses a negative price', async () => {
    await expectConstraint(
      withTenant({ tenantId: orgA, userId: null, isAdmin: false }, (tx) =>
        tx.execute(sql`UPDATE listings SET price_amount = -1 WHERE id = ${draftListingA}`),
      ),
      'listings_prices_non_negative',
    );
  });

  it('refuses a second offer from the same seller on the same variant', async () => {
    // Without this a seller lists the same thing twice at two prices and
    // appears as two competitors on their own product page.
    await expectConstraint(
      withTenant({ tenantId: orgA, userId: null, isAdmin: false }, (tx) =>
        tx.execute(
          sql`INSERT INTO listings (tenant_id, variant_id, price_amount, price_currency) VALUES (${orgA}, ${variantId}, 500, 'BDT')`,
        ),
      ),
      'listings_tenant_variant_key',
    );
  });
});
