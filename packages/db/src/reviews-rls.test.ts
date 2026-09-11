import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertAllProductRatings,
  insertAllSellerRatings,
  ratingDrift,
  recomputeProductRating,
  recomputeSellerRating,
} from './review-aggregates.js';
import * as schema from './schema/index.js';
import { makeWithTenant } from './tenant-context.js';

const here = dirname(fileURLToPath(import.meta.url));

let container: StartedPostgreSqlContainer;
let ownerPool: Pool;
let appPool: Pool;
let db: NodePgDatabase<typeof schema>;
let withTenant: ReturnType<typeof makeWithTenant>;

/** Namespaced per file, because `users.email` is globally unique and vitest
 *  runs files in parallel against one database. */
const NS = 'reviews-rls';

let productId = '';
let otherProductId = '';
let sellerA = '';
let sellerB = '';
let buyer = '';

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  ownerPool = new Pool({ connectionString: container.getConnectionUri(), max: 2 });
  await drizzle(ownerPool).execute(
    sql`CREATE ROLE nexmarket_app WITH LOGIN PASSWORD 'probe' NOBYPASSRLS`,
  );
  await migrate(drizzle(ownerPool), { migrationsFolder: join(here, '..', 'migrations') });

  // The APP role, exactly as the API connects. Running these assertions as the
  // container superuser would bypass every policy and prove nothing.
  const uri = new URL(container.getConnectionUri());
  uri.username = 'nexmarket_app';
  uri.password = 'probe';
  appPool = new Pool({ connectionString: uri.toString(), max: 4 });
  db = drizzle(appPool, { schema });
  withTenant = makeWithTenant(db);

  await seedFixture();
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await ownerPool?.end();
  await container?.stop();
});

/**
 * Two sellers, one shared product, one buyer with a delivered order from each.
 *
 * Written straight through the owner connection rather than through the API's
 * services: this file is about what the DATABASE enforces, and routing the
 * fixture through application code would let an application bug create a
 * fixture that hides a policy bug.
 */
async function seedFixture(): Promise<void> {
  const owner = drizzle(ownerPool, { schema });

  await owner.execute(sql`
    INSERT INTO currencies (code, name, symbol) VALUES ('BDT', 'Taka', '৳')
      ON CONFLICT DO NOTHING;
    INSERT INTO countries (code, name, dial_code) VALUES ('BD', 'Bangladesh', '+880')
      ON CONFLICT DO NOTHING;
  `);

  const orgs = await owner.execute<{ id: string }>(sql`
    INSERT INTO organisations (slug, legal_name, display_name, status, country_code, default_currency)
    VALUES (${`${NS}-a`}, 'A Ltd', 'Seller A', 'ACTIVE', 'BD', 'BDT'),
           (${`${NS}-b`}, 'B Ltd', 'Seller B', 'ACTIVE', 'BD', 'BDT')
    RETURNING id
  `);
  sellerA = orgs.rows[0]?.id ?? '';
  sellerB = orgs.rows[1]?.id ?? '';

  const users = await owner.execute<{ id: string }>(sql`
    INSERT INTO users (email, display_name, password_hash, platform_role)
    VALUES (${`${NS}-buyer@example.test`}, 'Buyer', 'x', 'BUYER')
    RETURNING id
  `);
  buyer = users.rows[0]?.id ?? '';

  const categories = await owner.execute<{ id: string }>(sql`
    INSERT INTO categories (slug, name, path) VALUES (${`${NS}-cat`}, 'Cat', ${`${NS.replace(/-/g, '_')}_cat`}::ltree)
    RETURNING id
  `);
  const categoryId = categories.rows[0]?.id ?? '';

  const products = await owner.execute<{ id: string }>(sql`
    INSERT INTO products (slug, name, category_id, status)
    VALUES (${`${NS}-p1`}, 'Shared product', ${categoryId}::uuid, 'ACTIVE'),
           (${`${NS}-p2`}, 'Other product',  ${categoryId}::uuid, 'ACTIVE')
    RETURNING id
  `);
  productId = products.rows[0]?.id ?? '';
  otherProductId = products.rows[1]?.id ?? '';
}

describe('reviews are platform-owned', () => {
  it('carries no row-level security on any trust table', async () => {
    /**
     * THE DECISION, asserted rather than commented.
     *
     * PRD 9.5 puts the rating and its histogram on the PRODUCT PAGE, which an
     * anonymous shopper opens with no session and no tenant. A tenant-owned
     * review table answers that reader with zero rows, so the page would show
     * "no reviews yet" on a product with four hundred of them - and nothing
     * would error. The catalogue got this call in Phase 2 and the geography
     * tables got it in Phase 6; this is the third application of ADR 0021.
     */
    const res = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ relname: string; relrowsecurity: boolean }>(
        sql`SELECT relname, relrowsecurity FROM pg_class
            WHERE relname IN ('reviews','product_ratings','seller_ratings')
            ORDER BY relname`,
      ),
    );

    expect(res.rows).toHaveLength(3);
    for (const row of res.rows) {
      expect(`${row.relname}: ${String(row.relrowsecurity)}`).toBe(`${row.relname}: false`);
    }
  });

  it('shows a product page reader every seller’s reviews, with no tenant selected', async () => {
    await givenReviews([
      { seller: sellerA, rating: 5 },
      { seller: sellerB, rating: 3 },
    ]);

    const res = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM reviews WHERE product_id = ${productId}::uuid`,
      ),
    );

    // TWO, from two different sellers, read with no tenant. This is the whole
    // reason the table is platform-owned.
    expect(res.rows[0]?.n).toBe(2);
  });

  it('still shows both when a tenant IS selected, because no policy narrows it', async () => {
    // A seller browsing the storefront carries their own tenant. If a policy
    // ever appears on this table, that seller starts seeing a product page with
    // only their own reviews on it - and the page still renders.
    const res = await withTenant({ tenantId: sellerA, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM reviews WHERE product_id = ${productId}::uuid`,
      ),
    );
    expect(res.rows[0]?.n).toBe(2);
  });
});

describe('rating aggregates', () => {
  it('recomputes a product histogram from its reviews', async () => {
    await recompute(productId, sellerA);
    await recompute(productId, sellerB);

    const row = await productRating(productId);
    // One 5 and one 3, and nothing anywhere else.
    expect([row.c1, row.c2, row.c3, row.c4, row.c5]).toEqual([0, 0, 1, 0, 1]);
  });

  it('counts one review against BOTH the product and the seller', async () => {
    const seller = await sellerRating(sellerA);
    expect([seller.c1, seller.c2, seller.c3, seller.c4, seller.c5]).toEqual([0, 0, 0, 0, 1]);
  });

  it('EXCLUDES a removed review and keeps a flagged one', async () => {
    /**
     * The two halves of the moderation decision, in one assertion.
     *
     * FLAGGED is still on the page - a report is an accusation, not a verdict -
     * so it still counts. REMOVED is gone from every surface, and the histogram
     * is one of them: a page that stopped showing a review while the average
     * above it still counted the stars would be visibly inconsistent.
     */
    await asOwner(sql`UPDATE reviews SET status = 'REMOVED' WHERE product_id = ${productId}::uuid AND rating = 5`);
    await asOwner(sql`UPDATE reviews SET status = 'FLAGGED' WHERE product_id = ${productId}::uuid AND rating = 3`);
    await recompute(productId, sellerA);
    await recompute(productId, sellerB);

    const row = await productRating(productId);
    expect([row.c1, row.c2, row.c3, row.c4, row.c5]).toEqual([0, 0, 1, 0, 0]);

    const seller = await sellerRating(sellerA);
    expect(seller.c5).toBe(0);
  });

  it('writes five zeroes rather than no row when every review is gone', async () => {
    // Same fact, one code path. A page reading "no aggregate row yet" and a
    // page reading five zeroes should not be two branches.
    await asOwner(sql`UPDATE reviews SET status = 'REMOVED' WHERE product_id = ${productId}::uuid`);
    await recompute(productId, sellerA);

    const row = await productRating(productId);
    expect([row.c1, row.c2, row.c3, row.c4, row.c5]).toEqual([0, 0, 0, 0, 0]);
  });

  it('NEVER DRIFTS from the reviews it summarises', async () => {
    /**
     * The `listings.available_stock` pattern, applied to a second
     * denormalisation. A denormalised column is trustworthy exactly as long as
     * something compares it to its source, and the comparison lives in
     * `review-aggregates.ts` beside the statements it checks - written inside
     * this test it would be a second definition that agrees with the bug.
     */
    await asOwner(sql`UPDATE reviews SET status = 'PUBLISHED' WHERE product_id = ${productId}::uuid`);
    await givenReviews([{ seller: sellerA, rating: 1, product: otherProductId }]);

    // A full rebuild, the way the seed does it.
    await asOwner(sql`DELETE FROM product_ratings`);
    await asOwner(sql`DELETE FROM seller_ratings`);
    await asOwner(insertAllProductRatings);
    await asOwner(insertAllSellerRatings);

    const drift = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute<{ kind: string; id: string }>(ratingDrift),
    );
    expect(drift.rows).toEqual([]);
  });

  it('catches drift when an aggregate is edited behind the service’s back', async () => {
    // The negative case, or the previous test only proves the query runs.
    await asOwner(sql`UPDATE product_ratings SET count_5 = count_5 + 7 WHERE product_id = ${productId}::uuid`);

    const drift = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute<{ kind: string; id: string }>(ratingDrift),
    );
    expect(drift.rows.map((row) => row.kind)).toContain('product');
  });
});

// ---- fixture helpers --------------------------------------------------------

let orderSeq = 0;

/**
 * Reviews, with the order line each one hangs off.
 *
 * The whole chain is built - listing, variant, order, order item - because
 * `reviews.order_item_id` is a foreign key and that is the point of the design:
 * there is no way to write a review without a purchase to attach it to, and a
 * fixture that could shortcut it would not be testing the same table.
 */
async function givenReviews(
  specs: { seller: string; rating: number; product?: string }[],
): Promise<void> {
  for (const spec of specs) {
    orderSeq += 1;
    const product = spec.product ?? productId;
    await asOwner(sql`
      WITH v AS (
        INSERT INTO product_variants (product_id, sku, name, position)
        VALUES (${product}::uuid, ${`${NS}-SKU-${String(orderSeq)}`}, 'V', 0)
        RETURNING id
      ),
      w AS (
        INSERT INTO warehouses (tenant_id, name, pincode)
        VALUES (${spec.seller}::uuid, ${`${NS}-wh-${String(orderSeq)}`}, '1205')
        RETURNING id
      ),
      l AS (
        INSERT INTO listings (tenant_id, variant_id, price_amount, price_currency, status)
        SELECT ${spec.seller}::uuid, v.id, 1000, 'BDT', 'ACTIVE' FROM v
        RETURNING id
      ),
      pi AS (
        INSERT INTO payment_intents (buyer_user_id, provider, amount_total, currency, status, idempotency_key)
        VALUES (${buyer}::uuid, 'mock', 1000, 'BDT', 'SUCCEEDED', ${`${NS}-key-${String(orderSeq)}`})
        RETURNING id
      ),
      o AS (
        INSERT INTO orders (tenant_id, buyer_user_id, payment_intent_id, order_number, status,
                            subtotal_amount, shipping_amount, tax_amount, total_amount,
                            commission_amount, currency, shipping_address, placed_at)
        SELECT ${spec.seller}::uuid, ${buyer}::uuid, pi.id, ${`NM-${NS}-${String(orderSeq)}`},
               'DELIVERED', 1000, 0, 0, 1000, 0, 'BDT', '{}'::jsonb, now()
          FROM pi
        RETURNING id
      ),
      oi AS (
        INSERT INTO order_items (tenant_id, order_id, listing_id, product_name, variant_sku,
                                 unit_price_amount, quantity, line_total_amount,
                                 commission_bps, commission_amount, currency)
        SELECT ${spec.seller}::uuid, o.id, l.id, 'Shared product', ${`${NS}-SKU-${String(orderSeq)}`},
               1000, 1, 1000, 0, 0, 'BDT'
          FROM o, l
        RETURNING id
      )
      INSERT INTO reviews (order_item_id, product_id, seller_org_id, author_user_id, rating, body)
      SELECT oi.id, ${product}::uuid, ${spec.seller}::uuid, ${buyer}::uuid, ${spec.rating}, 'ok'
        FROM oi
    `);
  }
}

function asOwner(statement: ReturnType<typeof sql>): Promise<unknown> {
  return drizzle(ownerPool, { schema }).execute(statement);
}

async function recompute(product: string, seller: string): Promise<void> {
  await withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
    await tx.execute(recomputeProductRating(product));
    await tx.execute(recomputeSellerRating(seller));
  });
}

type Counts = { c1: number; c2: number; c3: number; c4: number; c5: number };

async function productRating(product: string): Promise<Counts> {
  const res = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
    tx.execute<Counts>(
      sql`SELECT count_1 AS c1, count_2 AS c2, count_3 AS c3, count_4 AS c4, count_5 AS c5
            FROM product_ratings WHERE product_id = ${product}::uuid`,
    ),
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('no aggregate row');
  return row;
}

async function sellerRating(seller: string): Promise<Counts> {
  const res = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
    tx.execute<Counts>(
      sql`SELECT count_1 AS c1, count_2 AS c2, count_3 AS c3, count_4 AS c4, count_5 AS c5
            FROM seller_ratings WHERE tenant_id = ${seller}::uuid`,
    ),
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('no aggregate row');
  return row;
}
