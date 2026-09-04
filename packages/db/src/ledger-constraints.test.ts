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
 * The ledger invariants that live in the DATABASE rather than in TypeScript.
 *
 * `assertBalanced()` in @nexmarket/shared is covered to 100% and gives the fast,
 * precise failure. This file tests the half that cannot be bypassed: a
 * deferred constraint trigger, a CHECK, and a privilege set. They exist because
 * "we always call LedgerService.post()" is a claim no test can make about code
 * that has not been written yet.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

let container: StartedPostgreSqlContainer;
let appPool: Pool;
let withTenant: ReturnType<typeof makeWithTenant>;
let orgId: string;
let intentId: string;

const ctx = { tenantId: null, userId: null, isAdmin: false } as const;

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
    .values({ slug: 'led-a', legalName: 'A Ltd', displayName: 'A', countryCode: 'BD', defaultCurrency: 'BDT' })
    .returning({ id: schema.organisations.id });
  const org = orgs[0]?.id;
  if (org === undefined) throw new Error('fixture setup failed');
  orgId = org;

  const users = await ownerDb
    .insert(schema.users)
    .values({ email: 'ledger-constraints@example.test', displayName: 'Buyer' })
    .returning({ id: schema.users.id });
  const userId = users[0]?.id;
  if (userId === undefined) throw new Error('fixture setup failed');

  const intents = await ownerDb
    .insert(schema.paymentIntents)
    .values({
      buyerUserId: userId,
      provider: 'mock',
      amountTotal: 1000,
      currency: 'BDT',
      idempotencyKey: 'ledger-constraints-fixture',
    })
    .returning({ id: schema.paymentIntents.id });
  const intent = intents[0]?.id;
  if (intent === undefined) throw new Error('fixture setup failed');
  intentId = intent;

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

/** A fresh transaction row per case, so one case cannot balance another's. */
async function newTransaction(tx: Parameters<Parameters<typeof withTenant>[1]>[0]): Promise<string> {
  const rows = await tx
    .insert(schema.transactions)
    .values({ paymentIntentId: intentId, kind: 'CAPTURE', amount: 1000, currency: 'BDT' })
    .returning({ id: schema.transactions.id });
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('transaction insert returned nothing');
  return id;
}

async function accountId(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  kind: 'BUYER_RECEIVABLE' | 'PLATFORM_CLEARING' | 'SELLER_PAYABLE',
  ownerOrgId: string | null,
): Promise<string> {
  // INSERT ... DO NOTHING, then SELECT - NOT `DO UPDATE SET kind = EXCLUDED.kind`.
  //
  // The DO UPDATE idiom is the usual way to make an upsert return its row on
  // conflict, and it requires the UPDATE privilege. Migration 0012 revokes
  // UPDATE on ledger_accounts to make them immutable, so the two are in direct
  // tension and the upsert is the half that yields. This shape needs only
  // INSERT and SELECT, and it is still race-safe: if a concurrent transaction
  // won the insert, DO NOTHING returns no row and the SELECT finds theirs.
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO ledger_accounts (kind, owner_org_id, currency)
    VALUES (${kind}, ${ownerOrgId}, 'BDT')
    ON CONFLICT (kind, owner_org_id, currency) DO NOTHING
    RETURNING id
  `);
  const insertedId = inserted.rows[0]?.id;
  if (insertedId !== undefined) return insertedId;

  const found = await tx.execute<{ id: string }>(sql`
    SELECT id FROM ledger_accounts
    WHERE kind = ${kind} AND currency = 'BDT'
      AND owner_org_id IS NOT DISTINCT FROM ${ownerOrgId}
  `);
  const id = found.rows[0]?.id;
  if (id === undefined) throw new Error('account upsert found nothing');
  return id;
}


/**
 * Drizzle wraps driver errors in its own "Failed query:" message, so every
 * Postgres detail - SQLSTATE, constraint name, the RAISE text - lives on
 * `.cause` and never on `error.message`. A `rejects.toThrow(/does not balance/)`
 * therefore fails even when the trigger fires exactly as intended, which is how
 * this file first went red for the wrong reason.
 *
 * Same helpers as catalogue-rls.test.ts, and for the same reason: asserting the
 * SQLSTATE is what makes these specific. Without it "the write threw" passes
 * for a typo in the SQL as readily as for the invariant doing its job.
 */
async function causeOf(
  attempt: Promise<unknown>,
): Promise<{ code?: string; message?: string; constraint?: string }> {
  const error = await attempt.then(
    () => {
      throw new Error('expected the write to be refused, but it succeeded');
    },
    (e: unknown) => e,
  );
  const cause = (error as { cause?: { code?: string; message?: string; constraint?: string } })
    .cause;
  return cause ?? {};
}

/** A trigger RAISE arrives as SQLSTATE P0001 with the message on .cause. */
async function expectRaise(attempt: Promise<unknown>, pattern: RegExp): Promise<void> {
  const cause = await causeOf(attempt);
  expect(cause.code).toBe('P0001');
  expect(cause.message).toMatch(pattern);
}

async function expectConstraint(attempt: Promise<unknown>, name: string): Promise<void> {
  const cause = await causeOf(attempt);
  expect(cause.constraint).toBe(name);
}

/** Privilege refusals are SQLSTATE 42501. */
async function expectPermissionDenied(attempt: Promise<unknown>, table: string): Promise<void> {
  const cause = await causeOf(attempt);
  expect(cause.code).toBe('42501');
  expect(cause.message).toMatch(new RegExp(`permission denied for table ${table}`, 'i'));
}

describe('the balance invariant is enforced by the database', () => {
  it('accepts a balanced transaction', async () => {
    await expect(
      withTenant(ctx, async (tx) => {
        const transactionId = await newTransaction(tx);
        const debit = await accountId(tx, 'BUYER_RECEIVABLE', null);
        const credit = await accountId(tx, 'PLATFORM_CLEARING', null);
        await tx.insert(schema.ledgerEntries).values([
          { transactionId, accountId: debit, amount: 1000, currency: 'BDT' },
          { transactionId, accountId: credit, amount: -1000, currency: 'BDT' },
        ]);
      }),
    ).resolves.toBeUndefined();
  });

  /**
   * The heart of it: this write is legal at INSERT time and illegal at COMMIT.
   *
   * If the trigger were not DEFERRABLE INITIALLY DEFERRED it would fire after
   * the first row and reject every transaction ever written, because entries
   * are legitimately unbalanced between statements.
   */
  it('rejects an unbalanced transaction at COMMIT, not at INSERT', async () => {
    let insertSucceeded = false;

    await expectRaise(
      withTenant(ctx, async (tx) => {
        const transactionId = await newTransaction(tx);
        const debit = await accountId(tx, 'BUYER_RECEIVABLE', null);
        const credit = await accountId(tx, 'PLATFORM_CLEARING', null);
        await tx.insert(schema.ledgerEntries).values([
          { transactionId, accountId: debit, amount: 1000, currency: 'BDT' },
          { transactionId, accountId: credit, amount: -999, currency: 'BDT' },
        ]);
        // Both rows are in. Nothing has complained yet - that is the point.
        insertSucceeded = true;
      }),
      /does not balance: entries sum to 1/,
    );

    expect(insertSucceeded).toBe(true);
  });

  it('rejects a single-sided transaction', async () => {
    await expectRaise(
      withTenant(ctx, async (tx) => {
        const transactionId = await newTransaction(tx);
        const debit = await accountId(tx, 'BUYER_RECEIVABLE', null);
        await tx
          .insert(schema.ledgerEntries)
          .values({ transactionId, accountId: debit, amount: 500, currency: 'BDT' });
      }),
      /does not balance/,
    );
  });

  it('refuses to net one currency against another even when the numbers cancel', async () => {
    await expectRaise(
      withTenant(ctx, async (tx) => {
        const transactionId = await newTransaction(tx);
        const debit = await accountId(tx, 'BUYER_RECEIVABLE', null);
        const credit = await accountId(tx, 'PLATFORM_CLEARING', null);
        await tx.insert(schema.ledgerEntries).values([
          { transactionId, accountId: debit, amount: 1000, currency: 'BDT' },
          { transactionId, accountId: credit, amount: -1000, currency: 'USD' },
        ]);
      }),
      /mixes 2 currencies/,
    );
  });

  it('rejects a zero entry', async () => {
    await expectConstraint(
      withTenant(ctx, async (tx) => {
        const transactionId = await newTransaction(tx);
        const debit = await accountId(tx, 'BUYER_RECEIVABLE', null);
        const credit = await accountId(tx, 'PLATFORM_CLEARING', null);
        await tx.insert(schema.ledgerEntries).values([
          { transactionId, accountId: debit, amount: 0, currency: 'BDT' },
          { transactionId, accountId: credit, amount: 0, currency: 'BDT' },
        ]);
      }),
      'ledger_entries_nonzero',
    );
  });
});

describe('the ledger is append-only by privilege', () => {
  it('refuses UPDATE on a posted entry', async () => {
    await withTenant(ctx, async (tx) => {
      const transactionId = await newTransaction(tx);
      const debit = await accountId(tx, 'BUYER_RECEIVABLE', null);
      const credit = await accountId(tx, 'PLATFORM_CLEARING', null);
      await tx.insert(schema.ledgerEntries).values([
        { transactionId, accountId: debit, amount: 700, currency: 'BDT' },
        { transactionId, accountId: credit, amount: -700, currency: 'BDT' },
      ]);
    });

    await expectPermissionDenied(
      withTenant(ctx, (tx) => tx.execute(sql`UPDATE ledger_entries SET amount = 1`)),
      'ledger_entries',
    );
  });

  it('refuses DELETE on a posted entry', async () => {
    await expectPermissionDenied(
      withTenant(ctx, (tx) => tx.execute(sql`DELETE FROM ledger_entries`)),
      'ledger_entries',
    );
  });

  it('refuses UPDATE and DELETE on transactions and payment events', async () => {
    await expectPermissionDenied(
      withTenant(ctx, (tx) => tx.execute(sql`UPDATE transactions SET amount = 1`)),
      'transactions',
    );
    await expectPermissionDenied(
      withTenant(ctx, (tx) => tx.execute(sql`DELETE FROM payment_events`)),
      'payment_events',
    );
  });

  it('still allows the webhook to advance a payment intent', async () => {
    await expect(
      withTenant(ctx, (tx) =>
        tx.execute(sql`UPDATE payment_intents SET status = 'SUCCEEDED' WHERE id = ${intentId}`),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe('ledger accounts are unique per identity', () => {
  /**
   * NULLS NOT DISTINCT is load-bearing and easy to lose.
   *
   * Postgres treats NULLs as distinct in a unique constraint by default, so
   * without it every platform-wide account could be created without limit and
   * a balance query would silently read one of several partial balances.
   */
  it('treats two platform-wide accounts of the same kind as the same account', async () => {
    const first = await withTenant(ctx, (tx) => accountId(tx, 'PLATFORM_CLEARING', null));
    const second = await withTenant(ctx, (tx) => accountId(tx, 'PLATFORM_CLEARING', null));
    expect(second).toBe(first);

    const count = await withTenant(ctx, (tx) =>
      tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ledger_accounts WHERE kind = 'PLATFORM_CLEARING'`,
      ),
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('keeps one seller payable account per organisation', async () => {
    const mine = await withTenant(ctx, (tx) => accountId(tx, 'SELLER_PAYABLE', orgId));
    const again = await withTenant(ctx, (tx) => accountId(tx, 'SELLER_PAYABLE', orgId));
    expect(again).toBe(mine);
  });
});
