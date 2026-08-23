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

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(here, '..', 'migrations');

let container: StartedPostgreSqlContainer;
let appUri: string;
let appPool: Pool;
let withTenant: ReturnType<typeof makeWithTenant>;
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();

  // Fixtures are written by the container's default user, which the postgres
  // image creates as a SUPERUSER. Superusers bypass RLS even under FORCE, which
  // is exactly why the application must not connect as one.
  const ownerPool = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
  const ownerDb = drizzle(ownerPool, { schema });

  await ownerDb.execute(sql`CREATE ROLE nexmarket_app WITH LOGIN PASSWORD 'probe' NOBYPASSRLS`);
  await migrate(drizzle(ownerPool), { migrationsFolder });

  await ownerDb
    .insert(schema.countries)
    .values({ code: 'BD', name: 'Bangladesh', dialCode: '+880' });
  await ownerDb
    .insert(schema.currencies)
    .values({ code: 'BDT', name: 'Bangladeshi Taka', symbol: 'Tk' });

  const [a] = await ownerDb
    .insert(schema.organisations)
    .values({
      slug: 'tenant-a',
      legalName: 'Tenant A Ltd',
      displayName: 'Tenant A',
      countryCode: 'BD',
      defaultCurrency: 'BDT',
    })
    .returning({ id: schema.organisations.id });
  const [b] = await ownerDb
    .insert(schema.organisations)
    .values({
      slug: 'tenant-b',
      legalName: 'Tenant B Ltd',
      displayName: 'Tenant B',
      countryCode: 'BD',
      defaultCurrency: 'BDT',
    })
    .returning({ id: schema.organisations.id });

  if (!a || !b) throw new Error('fixture setup failed: organisations not returned');
  tenantA = a.id;
  tenantB = b.id;

  await ownerDb.insert(schema.rlsProbe).values([
    { tenantId: tenantA, payload: 'secret-of-a' },
    { tenantId: tenantB, payload: 'secret-of-b' },
  ]);
  await ownerPool.end();

  // The APPLICATION connects as nexmarket_app, which cannot bypass RLS.
  const uri = new URL(container.getConnectionUri());
  uri.username = 'nexmarket_app';
  uri.password = 'probe';
  appUri = uri.toString();
  appPool = new Pool({ connectionString: appUri, max: 5 });
  withTenant = makeWithTenant(drizzle(appPool, { schema }));
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await container?.stop();
});

describe('the connecting role', () => {
  it('cannot bypass RLS, or every other test in this file is meaningless', async () => {
    const res = await appPool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(res.rows[0]?.rolsuper).toBe(false);
    expect(res.rows[0]?.rolbypassrls).toBe(false);
  });
});

describe('withTenant', () => {
  it('sees only its own tenant rows', async () => {
    const rows = await withTenant({ tenantId: tenantA, isAdmin: false }, (tx) =>
      tx.select().from(schema.rlsProbe),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toBe('secret-of-a');
  });

  it('sees the other tenant rows when given the other tenant', async () => {
    const rows = await withTenant({ tenantId: tenantB, isAdmin: false }, (tx) =>
      tx.select().from(schema.rlsProbe),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toBe('secret-of-b');
  });

  it('returns ZERO rows when tenant context is omitted, never all rows', async () => {
    // PRD 6.4 acceptance criterion 4. Failing open here is a breach, not a bug.
    const rows = await withTenant({ tenantId: null, isAdmin: false }, (tx) =>
      tx.select().from(schema.rlsProbe),
    );
    expect(rows).toHaveLength(0);
  });

  it('lets a platform admin see across tenants', async () => {
    const rows = await withTenant({ tenantId: null, isAdmin: true }, (tx) =>
      tx.select().from(schema.rlsProbe),
    );
    expect(rows).toHaveLength(2);
  });

  it('refuses a write attributed to another tenant', async () => {
    // Drizzle wraps driver errors in its own "Failed query:" message, so the
    // Postgres detail lives on .cause. Asserting the SQLSTATE is stronger than
    // matching a wrapper string: 42501 is insufficient_privilege, which is what
    // a WITH CHECK violation raises.
    const attempt = withTenant({ tenantId: tenantA, isAdmin: false }, (tx) =>
      tx.insert(schema.rlsProbe).values({ tenantId: tenantB, payload: 'forged' }),
    );

    const error = await attempt.then(
      () => {
        throw new Error('expected the forged write to be refused, but it succeeded');
      },
      (e: unknown) => e,
    );

    const cause = (error as { cause?: unknown }).cause as
      | { code?: string; message?: string }
      | undefined;

    expect(cause?.code).toBe('42501');
    expect(cause?.message).toMatch(/row-level security/i);
  });

  it('leaves no trace of the refused cross-tenant write', async () => {
    const rows = await withTenant({ tenantId: null, isAdmin: true }, (tx) =>
      tx.select().from(schema.rlsProbe),
    );
    expect(rows.map((r) => r.payload)).not.toContain('forged');
  });

  it('does not leak tenant context to the next transaction on the same connection', async () => {
    // The pooling hazard itself (PRD 6.4). max:1 forces the second statement to
    // reuse the exact physical connection the transaction ran on. A plain SET
    // instead of set_config(..., true) would leave the value behind here.
    const singlePool = new Pool({ connectionString: appUri, max: 1 });
    const singleDb = drizzle(singlePool, { schema });
    try {
      await makeWithTenant(singleDb)({ tenantId: tenantA, isAdmin: false }, (tx) =>
        tx.select().from(schema.rlsProbe),
      );
      const leaked = await singleDb.execute<{ v: string | null }>(
        sql`SELECT current_setting('app.tenant_id', true) AS v`,
      );
      const value = leaked.rows[0]?.v ?? null;
      expect(value === null || value === '').toBe(true);
    } finally {
      await singlePool.end();
    }
  });

  it('keeps two tenants isolated under interleaved concurrent load', async () => {
    // PRD 6.4 acceptance criterion 3 and success criterion S1.
    // 40 requests alternating tenants over a 5-connection pool, so connections
    // are demonstrably reused across tenant boundaries mid-flight.
    const work = Array.from({ length: 40 }, (_, i) => {
      const tenantId = i % 2 === 0 ? tenantA : tenantB;
      const expected = i % 2 === 0 ? 'secret-of-a' : 'secret-of-b';
      return withTenant({ tenantId, isAdmin: false }, (tx) =>
        tx.select().from(schema.rlsProbe),
      ).then((rows) => ({ rows, expected }));
    });

    const results = await Promise.all(work);
    for (const { rows, expected } of results) {
      expect(rows).toHaveLength(1);
      expect(rows[0]?.payload).toBe(expected);
    }
  });

  it('rolls back and does not swallow an error from the callback', async () => {
    await expect(
      withTenant({ tenantId: tenantA, isAdmin: false }, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('rolls back writes when the callback throws after inserting', async () => {
    const marker = 'rollback-canary';
    await expect(
      withTenant({ tenantId: tenantA, isAdmin: false }, async (tx) => {
        await tx.insert(schema.rlsProbe).values({ tenantId: tenantA, payload: marker });
        throw new Error('abort after write');
      }),
    ).rejects.toThrow('abort after write');

    const rows = await withTenant({ tenantId: tenantA, isAdmin: false }, (tx) =>
      tx.select().from(schema.rlsProbe),
    );
    expect(rows.map((r) => r.payload)).not.toContain(marker);
  });
});
