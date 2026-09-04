import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenant, schema } from '@nexmarket/db';
import { money } from '@nexmarket/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';

/**
 * `LedgerService` against a real database.
 *
 * The pure rules are covered to 100% in @nexmarket/shared and the database
 * invariants in packages/db/src/ledger-constraints.test.ts. What is left, and
 * what this file is for, is the service's own behaviour: that accounts are
 * reused rather than duplicated, that a bigint SUM is normalised rather than
 * silently stringified, and that two concurrent posts to one account both land.
 *
 * It uses `withTenant` directly rather than HTTP because Phase 4 exposes no
 * ledger route - the admin ledger explorer is Phase 11. Posting is something
 * checkout and the webhook do, never something a caller asks for.
 */
const ledger = new LedgerService();

const ctx = { tenantId: null, userId: null, isAdmin: false } as const;

let orgId: string;
let intentId: string;
let buyerId: string;

/** Namespaced per file: vitest runs files in parallel against one database. */
const SUFFIX = randomUUID().slice(0, 8);

beforeAll(async () => {
  await withTenant(ctx, async (tx) => {
    const [org] = await tx
      .insert(schema.organisations)
      .values({
        slug: `ledger-e2e-${SUFFIX}`,
        legalName: 'Ledger Test Ltd',
        displayName: 'Ledger Test',
        countryCode: 'BD',
        defaultCurrency: 'BDT',
      })
      .returning({ id: schema.organisations.id });

    const [buyer] = await tx
      .insert(schema.users)
      .values({ email: `ledger-${SUFFIX}@example.test`, displayName: 'Ledger Buyer' })
      .returning({ id: schema.users.id });

    if (org === undefined || buyer === undefined) throw new Error('fixture setup failed');
    orgId = org.id;
    buyerId = buyer.id;

    const [intent] = await tx
      .insert(schema.paymentIntents)
      .values({
        buyerUserId: buyerId,
        provider: 'mock',
        amountTotal: 1000,
        currency: 'BDT',
        idempotencyKey: `ledger-e2e-${SUFFIX}`,
      })
      .returning({ id: schema.paymentIntents.id });
    if (intent === undefined) throw new Error('fixture setup failed');
    intentId = intent.id;
  });
}, 120_000);

const bdt = (amount: number) => money(amount, 'BDT');

describe('LedgerService.post', () => {
  it('writes the PRD 10.1 worked example and reads it back balanced', async () => {
    const transactionId = await withTenant(ctx, (tx) =>
      ledger.post(tx, {
        paymentIntentId: intentId,
        kind: 'CAPTURE',
        entries: [
          { kind: 'BUYER_RECEIVABLE', ownerOrgId: null, amount: bdt(1000) },
          { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: bdt(-1000) },
          { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: bdt(1000) },
          { kind: 'SELLER_PAYABLE', ownerOrgId: orgId, amount: bdt(-900) },
          { kind: 'PLATFORM_REVENUE_COMMISSION', ownerOrgId: null, amount: bdt(-100) },
        ],
      }),
    );

    const entries = await withTenant(ctx, (tx) => ledger.entriesForTransaction(tx, transactionId));
    expect(entries).toHaveLength(5);
    expect(entries.reduce((acc, e) => acc + e.amount, 0)).toBe(0);
    expect(entries.find((e) => e.kind === 'SELLER_PAYABLE')?.ownerOrgId).toBe(orgId);
  });

  it('refuses an unbalanced posting BEFORE writing a transactions row', async () => {
    const before = await withTenant(ctx, (tx) =>
      tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM transactions WHERE payment_intent_id = ${intentId}`,
      ),
    );

    await expect(
      withTenant(ctx, (tx) =>
        ledger.post(tx, {
          paymentIntentId: intentId,
          kind: 'CAPTURE',
          entries: [
            { kind: 'BUYER_RECEIVABLE', ownerOrgId: null, amount: bdt(1000) },
            { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: bdt(-999) },
          ],
        }),
      ),
    ).rejects.toThrow(/does not balance/);

    const after = await withTenant(ctx, (tx) =>
      tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM transactions WHERE payment_intent_id = ${intentId}`,
      ),
    );
    // Not merely "it threw": a rejected posting must not leave behind a
    // transactions row that a later reader would take for an event.
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('reuses one account per identity instead of creating a second', async () => {
    await withTenant(ctx, (tx) =>
      ledger.post(tx, {
        paymentIntentId: intentId,
        kind: 'CAPTURE',
        entries: [
          { kind: 'SELLER_PAYABLE', ownerOrgId: orgId, amount: bdt(50) },
          { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: bdt(-50) },
        ],
      }),
    );

    const rows = await withTenant(ctx, (tx) =>
      tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM ledger_accounts
        WHERE kind = 'SELLER_PAYABLE' AND owner_org_id = ${orgId} AND currency = 'BDT'
      `),
    );
    expect(rows.rows[0]?.n).toBe(1);
  });
});

describe('LedgerService.balanceFor', () => {
  /**
   * SUM(bigint) comes back from node-postgres as a STRING, because the sum can
   * exceed Number.MAX_SAFE_INTEGER. A raw tx.execute skips Drizzle's column
   * mapping, so without normalisation this returns "-850" and every arithmetic
   * comparison against it silently coerces or concatenates.
   */
  it('returns a number, not a string, and gets the sign right', async () => {
    const balance = await withTenant(ctx, (tx) =>
      ledger.balanceFor(tx, 'SELLER_PAYABLE', orgId, 'BDT'),
    );
    expect(typeof balance.amount).toBe('number');
    // -900 from the worked example, +50 from the reuse case.
    expect(balance).toEqual(bdt(-850));
  });

  it('scopes to the owning organisation — the only boundary these tables have', async () => {
    const other = await withTenant(ctx, (tx) =>
      ledger.balanceFor(tx, 'SELLER_PAYABLE', randomUUID(), 'BDT'),
    );
    expect(other).toEqual(bdt(0));
  });

  it('returns zero for an account that has never been posted to', async () => {
    // USD, not BDT. COD_RECEIVABLE in BDT is a PLATFORM-WIDE account, and
    // checkout.e2e posts cash-on-delivery accruals to it from a parallel test
    // file - so asserting zero there passed alone and failed in the suite. The
    // property under test is "an unposted account reads zero", which needs an
    // account nothing else can reach.
    const untouched = await withTenant(ctx, (tx) =>
      ledger.balanceFor(tx, 'COD_RECEIVABLE', null, 'USD'),
    );
    expect(untouched).toEqual(money(0, 'USD'));
  });
});

describe('concurrency', () => {
  /**
   * PRD 10.1's fourth ledger invariant: "concurrent writes to one account
   * serialise correctly."
   *
   * Ten transactions posting against the same seller payable account at once.
   * The account upsert races - that is the point - and INSERT ... DO NOTHING
   * plus SELECT is what makes the loser find the winner's row instead of
   * failing on the unique constraint.
   */
  it('lands every concurrent posting exactly once', async () => {
    const before = await withTenant(ctx, (tx) =>
      ledger.balanceFor(tx, 'PLATFORM_REVENUE_COMMISSION', null, 'BDT'),
    );

    await Promise.all(
      Array.from({ length: 10 }, () =>
        withTenant(ctx, (tx) =>
          ledger.post(tx, {
            paymentIntentId: intentId,
            kind: 'CAPTURE',
            entries: [
              { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: bdt(7) },
              { kind: 'PLATFORM_REVENUE_COMMISSION', ownerOrgId: null, amount: bdt(-7) },
            ],
          }),
        ),
      ),
    );

    const after = await withTenant(ctx, (tx) =>
      ledger.balanceFor(tx, 'PLATFORM_REVENUE_COMMISSION', null, 'BDT'),
    );
    expect(after.amount).toBe(before.amount - 70);

    const accounts = await withTenant(ctx, (tx) =>
      tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM ledger_accounts
        WHERE kind = 'PLATFORM_REVENUE_COMMISSION' AND owner_org_id IS NULL AND currency = 'BDT'
      `),
    );
    expect(accounts.rows[0]?.n).toBe(1);
  });
});
