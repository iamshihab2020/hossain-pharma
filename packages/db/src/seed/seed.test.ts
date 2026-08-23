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
let db: NodePgDatabase<typeof schema>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri(), max: 2 });
  db = drizzle(pool, { schema });
  await db.execute(sql`CREATE ROLE hossain_app WITH LOGIN PASSWORD 'probe' NOBYPASSRLS`);
  await migrate(drizzle(pool), { migrationsFolder: join(here, '..', '..', 'migrations') });
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('seed', () => {
  it('creates reference data and 8 seller organisations', async () => {
    const summary = await seed(db);
    expect(summary.organisations).toBe(8);
    expect(summary.currencies).toBeGreaterThanOrEqual(2);
    expect(summary.countries).toBeGreaterThanOrEqual(2);
  });

  it('is idempotent, so running it twice does not duplicate or throw', async () => {
    // S4 requires `pnpm seed` to be safe to re-run on a machine that already
    // has data. A seed that only works on an empty database is a demo, not a
    // harness.
    const second = await seed(db);
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

  it('gives every organisation a distinct slug', async () => {
    const orgs = await db.select().from(schema.organisations);
    expect(new Set(orgs.map((o) => o.slug)).size).toBe(orgs.length);
  });
});
