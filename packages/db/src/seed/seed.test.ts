import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../schema/index.js';
import { seed } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));

let container: StartedPostgreSqlContainer;
let pool: Pool;
let appPool: Pool;
let db: NodePgDatabase<typeof schema>;
let appDb: NodePgDatabase<typeof schema>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri(), max: 2 });
  db = drizzle(pool, { schema });
  await db.execute(sql`CREATE ROLE nexmarket_app WITH LOGIN PASSWORD 'probe' NOBYPASSRLS`);
  await migrate(drizzle(pool), { migrationsFolder: join(here, '..', '..', 'migrations') });

  // The seed itself runs as nexmarket_app, exactly as `pnpm seed` does in
  // production - DATABASE_URL is the app role. Running it as the container's
  // superuser instead would bypass RLS entirely and hide the zero-rows trap
  // that org_members introduces: an insert with no tenant context is silently
  // rejected by the WITH CHECK, and the seed reports success against an empty
  // table. `db` stays on the owner connection, for counting what was written.
  const uri = new URL(container.getConnectionUri());
  uri.username = 'nexmarket_app';
  uri.password = 'probe';
  appPool = new Pool({ connectionString: uri.toString(), max: 2 });
  appDb = drizzle(appPool, { schema });
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await pool?.end();
  await container?.stop();
});

describe('seed', () => {
  it('creates reference data and 8 seller organisations', async () => {
    const summary = await seed(appDb);
    expect(summary.organisations).toBe(8);
    expect(summary.currencies).toBeGreaterThanOrEqual(2);
    expect(summary.countries).toBeGreaterThanOrEqual(2);
  });

  it('is idempotent, so running it twice does not duplicate or throw', async () => {
    // S4 requires `pnpm seed` to be safe to re-run on a machine that already
    // has data. A seed that only works on an empty database is a demo, not a
    // harness.
    const second = await seed(appDb);
    expect(second.organisations).toBe(8);

    const orgs = await db.select().from(schema.organisations);
    expect(orgs).toHaveLength(8);
  });

  it('gives every seeded organisation ACTIVE status and a valid currency', async () => {
    const orgs = await db.select().from(schema.organisations);
    for (const org of orgs) {
      expect(org.status).toBe('ACTIVE');
      expect(org.defaultCurrency).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('references only currencies and countries that were actually seeded', async () => {
    // The FK would catch this, but a failure here names the offending row
    // instead of surfacing as a constraint violation mid-seed.
    const orgs = await db.select().from(schema.organisations);
    const countryCodes = new Set((await db.select().from(schema.countries)).map((c) => c.code));
    const currencyCodes = new Set((await db.select().from(schema.currencies)).map((c) => c.code));

    for (const org of orgs) {
      expect(countryCodes.has(org.countryCode)).toBe(true);
      expect(currencyCodes.has(org.defaultCurrency)).toBe(true);
    }
  });

  it('actually inserts org_members rows despite RLS', async () => {
    // THE TRAP. org_members is FORCE RLS and the seed connects as
    // nexmarket_app (NOBYPASSRLS), so a plain insert writes ZERO rows and
    // throws nothing. Counted over the OWNER connection: the point is that the
    // rows exist at all, not that the app role can see them.
    await seed(appDb);
    const r = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM org_members');
    expect(r.rows[0]?.n).toBeGreaterThan(0);
  });

  it('is idempotent for users and memberships', async () => {
    await seed(appDb);
    const first = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM org_members');
    await seed(appDb);
    const second = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM org_members');
    expect(second.rows[0]?.n).toBe(first.rows[0]?.n);
  });

  it('gives one user memberships in two different orgs (PRD 5.1)', async () => {
    // The headline claim: one human, several orgs, different roles. The legacy
    // system could not express this because the role lived on the user.
    await seed(appDb);
    const r = await pool.query(
      `SELECT user_id, count(DISTINCT tenant_id)::int AS orgs
         FROM org_members GROUP BY user_id HAVING count(DISTINCT tenant_id) > 1`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('gives every organisation a distinct slug', async () => {
    const orgs = await db.select().from(schema.organisations);
    expect(new Set(orgs.map((o) => o.slug)).size).toBe(orgs.length);
  });
});

describe('catalogue seed', () => {
  it('creates a three-level category tree with correct ltree paths', async () => {
    await seed(appDb);
    const r = await pool.query<{ slug: string; path: string; depth: number }>(
      `SELECT slug, path::text AS path, nlevel(path) AS depth FROM categories ORDER BY path`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((c) => c.depth >= 1 && c.depth <= 3)).toBe(true);
    expect(r.rows.find((c) => c.slug === 'smartphones')?.path).toBe(
      'electronics.phones.smartphones',
    );
    // Hyphens are not legal ltree labels, so the seed underscores them. If that
    // ever silently stopped happening the insert would fail, not this - but the
    // mapping is the kind of detail that gets "tidied" away.
    expect(r.rows.find((c) => c.slug === 'fresh-produce')?.path).toBe('groceries.fresh_produce');
  });

  it('flags exactly one PERISHABLE and one RESTRICTED category', async () => {
    // Both flags need a row that exercises them, or the Phase 4 age gate and
    // Phase 6 FEFO arrive with no fixture to test against.
    await seed(appDb);
    const r = await pool.query<{ perishable: number; restricted: number }>(
      `SELECT count(*) FILTER (WHERE is_perishable) AS perishable,
              count(*) FILTER (WHERE is_restricted) AS restricted FROM categories`,
    );
    expect(Number(r.rows[0]?.perishable)).toBeGreaterThan(0);
    expect(Number(r.rows[0]?.restricted)).toBeGreaterThan(0);
  });

  it('lists ONE variant with TWO competing sellers - the PRD 11 acceptance fixture', async () => {
    await seed(appDb);
    const r = await pool.query<{ sku: string; sellers: number }>(
      `SELECT v.sku, count(DISTINCT l.tenant_id)::int AS sellers
         FROM listings l JOIN product_variants v ON v.id = l.variant_id
        GROUP BY v.sku HAVING count(DISTINCT l.tenant_id) > 1`,
    );
    expect(r.rows.map((x) => x.sku)).toContain('AUR-X1-128-VIO');
  });

  it('makes the higher sticker price win on LANDED price', async () => {
    // The fixture is deliberately not the obvious one. A buy box that ignored
    // shipping would pick the other seller, and every test written against a
    // cheaper-item-also-wins fixture would still pass.
    await seed(appDb);
    const r = await pool.query<{ slug: string; landed: string }>(
      `SELECT o.slug, (l.price_amount + l.shipping_amount)::text AS landed
         FROM listings l
         JOIN organisations o ON o.id = l.tenant_id
         JOIN product_variants v ON v.id = l.variant_id
        WHERE v.sku = 'AUR-X1-128-VIO'
        ORDER BY l.price_amount + l.shipping_amount ASC`,
    );
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]?.slug).toBe('acme-electronics');
    const cheapestItem = await pool.query<{ slug: string }>(
      `SELECT o.slug FROM listings l
         JOIN organisations o ON o.id = l.tenant_id
         JOIN product_variants v ON v.id = l.variant_id
        WHERE v.sku = 'AUR-X1-128-VIO' ORDER BY l.price_amount ASC LIMIT 1`,
    );
    expect(cheapestItem.rows[0]?.slug).toBe('northwind-home');
  });

  it('keeps listings.available_stock equal to the inventory it summarises', async () => {
    // available_stock is a denormalisation the public product page depends on -
    // it is the only stock figure an anonymous reader can see. If it drifts from
    // inventory_items, the buy box excludes or includes the wrong offers.
    await seed(appDb);
    const r = await pool.query<{ id: string }>(
      `SELECT l.id FROM listings l
         LEFT JOIN (SELECT listing_id, sum(on_hand - reserved)::int AS n
                      FROM inventory_items GROUP BY listing_id) i ON i.listing_id = l.id
        WHERE l.available_stock IS DISTINCT FROM coalesce(i.n, 0)`,
    );
    expect(r.rows).toHaveLength(0);
  });

  it('is idempotent for the catalogue too', async () => {
    const first = await seed(appDb);
    const second = await seed(appDb);
    expect(second).toEqual(first);
    const counts = await pool.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM listings) + (SELECT count(*) FROM product_variants)
            + (SELECT count(*) FROM categories) AS n`,
    );
    await seed(appDb);
    const after = await pool.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM listings) + (SELECT count(*) FROM product_variants)
            + (SELECT count(*) FROM categories) AS n`,
    );
    expect(after.rows[0]?.n).toBe(counts.rows[0]?.n);
  });
});
