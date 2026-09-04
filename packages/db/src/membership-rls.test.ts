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
let appPool: Pool;
let withTenant: ReturnType<typeof makeWithTenant>;
let orgA: string;
let orgB: string;
let karimId: string;
let outsiderId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();

  // Fixtures are written by the container's default user, a SUPERUSER, which
  // bypasses RLS even under FORCE. That is exactly why the application must not
  // connect as one - and it is what lets this file plant rows it then proves
  // the application role cannot see.
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
      {
        slug: 'org-a',
        legalName: 'Org A Ltd',
        displayName: 'Org A',
        countryCode: 'BD',
        defaultCurrency: 'BDT',
      },
      {
        slug: 'org-b',
        legalName: 'Org B Ltd',
        displayName: 'Org B',
        countryCode: 'BD',
        defaultCurrency: 'BDT',
      },
    ])
    .returning({ id: schema.organisations.id });

  const people = await ownerDb
    .insert(schema.users)
    .values([
      { email: 'karim@example.com', displayName: 'Karim' },
      { email: 'outsider@example.com', displayName: 'Outsider' },
    ])
    .returning({ id: schema.users.id });

  const [a, b] = orgs;
  const [karim, outsider] = people;
  if (!a || !b || !karim || !outsider) throw new Error('fixture setup failed');
  orgA = a.id;
  orgB = b.id;
  karimId = karim.id;
  outsiderId = outsider.id;

  // PRD 5.1's headline case: one human OWNS one org and is STAFF in another.
  await ownerDb.insert(schema.orgMembers).values([
    { tenantId: orgA, userId: karimId, role: 'OWNER' },
    { tenantId: orgB, userId: karimId, role: 'STAFF' },
    { tenantId: orgB, userId: outsiderId, role: 'OWNER' },
  ]);

  await ownerDb.insert(schema.sellerDocuments).values([
    {
      tenantId: orgA,
      type: 'TRADE_LICENCE',
      storageKey: 'a/licence',
      originalFilename: 'a.pdf',
      contentType: 'application/pdf',
    },
    {
      tenantId: orgB,
      type: 'TRADE_LICENCE',
      storageKey: 'b/licence',
      originalFilename: 'b.pdf',
      contentType: 'application/pdf',
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

/**
 * Drizzle wraps driver errors in its own "Failed query:" message, so the
 * Postgres detail lives on .cause. Asserting the SQLSTATE is stronger than
 * matching a wrapper string: 42501 is insufficient_privilege, which is what a
 * WITH CHECK violation raises.
 */
async function expectRlsRefusal(attempt: Promise<unknown>): Promise<void> {
  const error = await attempt.then(
    () => {
      throw new Error('expected the write to be refused, but it succeeded');
    },
    (e: unknown) => e,
  );
  const cause = (error as { cause?: unknown }).cause as
    | { code?: string; message?: string }
    | undefined;
  expect(cause?.code).toBe('42501');
  expect(cause?.message).toMatch(/row-level security/i);
}

describe('org_members RLS', () => {
  it('returns ZERO rows when no tenant context is set', async () => {
    // PRD 6.4 criterion 4. Failing open here exposes every seller's staff list.
    const res = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute(sql`SELECT id FROM org_members`),
    );
    expect(res.rows).toHaveLength(0);
  });

  it('shows tenant A only its own members', async () => {
    const res = await withTenant({ tenantId: orgA, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ tenant_id: string }>(sql`SELECT tenant_id FROM org_members`),
    );
    expect(res.rows).not.toHaveLength(0);
    expect(res.rows.every((r) => r.tenant_id === orgA)).toBe(true);
  });

  it('does not widen a tenant-scoped read with the caller own rows elsewhere', async () => {
    // The regression 0006 exists for, and the reason the test above passes
    // userId: null - which is exactly why it missed this.
    //
    // Permissive policies are ORed. While own_membership applied at all times,
    // a tenant-scoped SELECT returned tenant A's rows PLUS the caller's rows in
    // tenant B, and "a tenant-scoped query returns that tenant's rows" quietly
    // stopped being true. Karim is a member of both A and B, so this is the
    // shortest case that can tell the difference.
    const res = await withTenant({ tenantId: orgA, userId: karimId, isAdmin: false }, (tx) =>
      tx.execute<{ tenant_id: string }>(sql`SELECT tenant_id FROM org_members`),
    );
    expect(res.rows).not.toHaveLength(0);
    expect(res.rows.every((r) => r.tenant_id === orgA)).toBe(true);
  });

  it('lets a user enumerate their own memberships with NO tenant context', async () => {
    // Plan D-A: the bootstrap read that decides which tenant the caller may act
    // as. Without own_membership this returns zero rows and login is useless.
    const res = await withTenant({ tenantId: null, userId: karimId, isAdmin: false }, (tx) =>
      tx.execute<{ tenant_id: string }>(sql`SELECT tenant_id FROM org_members`),
    );
    const tenants = res.rows.map((r) => r.tenant_id).sort();
    expect(tenants).toEqual([orgA, orgB].sort());
  });

  it('does not show one user another user rows via own_membership', async () => {
    // own_membership must scope to the CALLER, not open the table.
    const res = await withTenant({ tenantId: null, userId: outsiderId, isAdmin: false }, (tx) =>
      tx.execute<{ user_id: string }>(sql`SELECT user_id FROM org_members`),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.user_id).toBe(outsiderId);
  });

  it('does NOT let a user insert a membership without a tenant context', async () => {
    // The escalation this policy exists to close. If this passes, own_membership
    // has a WITH CHECK it must not have, and any user can self-grant OWNER.
    await expectRlsRefusal(
      withTenant({ tenantId: null, userId: karimId, isAdmin: false }, (tx) =>
        tx.execute(
          sql`INSERT INTO org_members (tenant_id, user_id, role) VALUES (${orgB}, ${karimId}, 'OWNER')`,
        ),
      ),
    );
  });

  it('does NOT let a tenant write a membership attributed to another tenant', async () => {
    await expectRlsRefusal(
      withTenant({ tenantId: orgA, userId: karimId, isAdmin: false }, (tx) =>
        tx.execute(
          sql`INSERT INTO org_members (tenant_id, user_id, role) VALUES (${orgB}, ${karimId}, 'MANAGER')`,
        ),
      ),
    );
  });

  it('lets a platform admin see across tenants', async () => {
    const res = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute(sql`SELECT id FROM org_members`),
    );
    expect(res.rows).toHaveLength(3);
  });
});

describe('seller_documents RLS', () => {
  it('returns ZERO rows when no tenant context is set', async () => {
    const res = await withTenant({ tenantId: null, userId: karimId, isAdmin: false }, (tx) =>
      tx.execute(sql`SELECT id FROM seller_documents`),
    );
    // userId is set and still yields nothing: there is no own_membership
    // equivalent here, and a caller's identity alone must not open the table.
    expect(res.rows).toHaveLength(0);
  });

  it('does not leak seller_documents across tenants', async () => {
    const res = await withTenant({ tenantId: orgA, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ tenant_id: string }>(sql`SELECT tenant_id FROM seller_documents`),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows.every((r) => r.tenant_id === orgA)).toBe(true);
  });

  it('lets an admin review documents across every tenant', async () => {
    // This IS the approval queue (Task 12).
    const res = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute(sql`SELECT id FROM seller_documents`),
    );
    expect(res.rows).toHaveLength(2);
  });
});

/**
 * PRD 6.4, and the Phase 1 exit checklist.
 *
 * ENABLE without FORCE is decoration: the table OWNER bypasses every policy,
 * and migrations own these tables. This asserts the catalog directly rather
 * than inferring it from behaviour, because behaviour under the app role looks
 * identical either way - the difference only appears for the owner, which is
 * precisely the connection no test uses.
 */
describe('FORCE ROW LEVEL SECURITY', () => {
  it('is set on every tenant-owned table', async () => {
    const res = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        sql`SELECT relname, relrowsecurity, relforcerowsecurity
            FROM pg_class
            WHERE relname IN ('org_members', 'seller_documents', 'rls_probe')
            ORDER BY relname`,
      ),
    );
    expect(res.rows.map((r) => r.relname)).toEqual([
      'org_members',
      'rls_probe',
      'seller_documents',
    ]);
    for (const row of res.rows) {
      expect(`${row.relname}: enabled=${String(row.relrowsecurity)}`).toBe(
        `${row.relname}: enabled=true`,
      );
      expect(`${row.relname}: forced=${String(row.relforcerowsecurity)}`).toBe(
        `${row.relname}: forced=true`,
      );
    }
  });

  it('leaves platform-owned identity tables WITHOUT row-level security', async () => {
    // The other direction, and it is a decision rather than an omission: PRD 6.2
    // says buyers belong to the platform and shop across all sellers, so a
    // tenant policy on `users` would be wrong, not missing. Asserting it stops
    // someone "fixing" the gap later.
    const res = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ relname: string; relrowsecurity: boolean }>(
        sql`SELECT relname, relrowsecurity FROM pg_class
            WHERE relname IN ('users', 'user_identities', 'sessions', 'organisations')
            ORDER BY relname`,
      ),
    );
    expect(res.rows).toHaveLength(4);
    for (const row of res.rows) {
      expect(`${row.relname}: ${String(row.relrowsecurity)}`).toBe(`${row.relname}: false`);
    }
  });
});
