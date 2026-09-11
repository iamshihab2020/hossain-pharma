import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type Transaction, schema } from '@nexmarket/db';
import {
  type AccountKind,
  type Entry,
  type Money,
  assertBalanced,
  money,
} from '@nexmarket/shared';

/**
 * THE ONLY WRITER of `ledger_entries` and `ledger_accounts` in the API.
 *
 * Every method takes the CALLER's transaction rather than opening its own, so
 * the postings commit with the event that caused them. An order placed and a
 * ledger write that failed afterwards is strictly worse than neither happening.
 *
 * There is no `withoutTenantScope` here and there must not be. The ledger
 * tables carry no row-level security at all (migration 0012): one capture posts
 * against two sellers' payable accounts and the platform's revenue account, so
 * there is no single tenant the write belongs to. The boundary on reads is
 * `owner_org_id`, applied in `balanceFor` and in every caller.
 *
 * The balance rule is enforced THREE times, deliberately:
 *   1. `assertBalanced` here, before any write - the fast, precise failure;
 *   2. a deferred constraint trigger at COMMIT - the one that cannot be
 *      bypassed by a future service that skips this class;
 *   3. `ledger_entries_nonzero`, a CHECK, for the degenerate case.
 * See ADR 0016.
 */
@Injectable()
export class LedgerService {
  /**
   * Posts one balanced transaction.
   *
   * Returns the transaction id so a caller can attach it to an order or a
   * webhook event without a second lookup.
   */
  async post(
    tx: Transaction,
    input: {
      paymentIntentId: string;
      kind: 'CAPTURE' | 'REFUND' | 'COD_ACCRUAL' | 'COD_COLLECTION' | 'FULFILMENT';
      entries: readonly Entry[];
    },
  ): Promise<string> {
    // Before the insert, not after. A rejected posting should never have
    // written a transactions row that a later reader would read as an event
    // that happened.
    assertBalanced(input.entries);

    const [transaction] = await tx
      .insert(schema.transactions)
      .values({
        paymentIntentId: input.paymentIntentId,
        kind: input.kind,
        amount: debitTotal(input.entries),
        currency: input.entries[0]?.amount.currency ?? 'BDT',
      })
      .returning({ id: schema.transactions.id });

    if (transaction === undefined) {
      throw new Error('Ledger transaction insert returned no row');
    }

    // Sequentially, not Promise.all. Sharing one transaction client across
    // concurrent queries is deprecated in pg 8 and removed in pg 9, and the
    // failure mode is interleaved protocol frames rather than a clean error.
    for (const entry of input.entries) {
      const accountId = await this.accountFor(tx, entry.kind, entry.ownerOrgId, entry.amount.currency);
      await tx.insert(schema.ledgerEntries).values({
        transactionId: transaction.id,
        accountId,
        amount: entry.amount.amount,
        currency: entry.amount.currency,
      });
    }

    return transaction.id;
  }

  /**
   * The balance of one account, as Money.
   *
   * `ownerOrgId` IS the authorisation boundary for a seller reading their own
   * payable, and it is a required argument rather than an optional filter so
   * that omitting it is a type error rather than a silent cross-seller read.
   */
  async balanceFor(
    tx: Transaction,
    kind: AccountKind,
    ownerOrgId: string | null,
    currency: string,
  ): Promise<Money> {
    const rows = await tx.execute<{ total: string | number | null }>(sql`
      SELECT COALESCE(SUM(e.amount), 0) AS total
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      WHERE a.kind = ${kind}
        AND a.currency = ${currency}
        AND a.owner_org_id IS NOT DISTINCT FROM ${ownerOrgId}
    `);

    // SUM(bigint) comes back as a STRING from node-postgres, because a bigint
    // sum can exceed Number.MAX_SAFE_INTEGER. A raw tx.execute skips Drizzle's
    // column mapping, so this normalisation cannot be skipped - and `+null` is
    // 0, which would look like a working balance of zero forever.
    const raw = rows.rows[0]?.total ?? 0;
    return money(typeof raw === 'string' ? Number.parseInt(raw, 10) : raw, currency);
  }

  /** Every entry of one transaction, for the admin ledger explorer and tests. */
  async entriesForTransaction(
    tx: Transaction,
    transactionId: string,
  ): Promise<{ kind: AccountKind; ownerOrgId: string | null; amount: number; currency: string }[]> {
    const rows = await tx.execute<{
      kind: AccountKind;
      owner_org_id: string | null;
      amount: string | number;
      currency: string;
    }>(sql`
      SELECT a.kind, a.owner_org_id, e.amount, e.currency
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      WHERE e.transaction_id = ${transactionId}
      ORDER BY e.created_at, e.id
    `);

    return rows.rows.map((row) => ({
      kind: row.kind,
      ownerOrgId: row.owner_org_id,
      amount: typeof row.amount === 'string' ? Number.parseInt(row.amount, 10) : row.amount,
      currency: row.currency,
    }));
  }

  /**
   * Finds or creates one account.
   *
   * INSERT ... DO NOTHING then SELECT, NOT `DO UPDATE SET kind = EXCLUDED.kind`.
   * The DO UPDATE idiom is the usual way to make an upsert return its row on
   * conflict and it requires the UPDATE privilege, which migration 0012 revokes
   * to keep accounts immutable. This shape needs only INSERT and SELECT and is
   * still race-safe: if a concurrent transaction won the insert, DO NOTHING
   * returns nothing and the SELECT finds theirs.
   *
   * `IS NOT DISTINCT FROM` rather than `=`, because owner_org_id is NULL for
   * every platform-wide kind and `NULL = NULL` is NULL, which would create a
   * second clearing account on every call.
   */
  private async accountFor(
    tx: Transaction,
    kind: AccountKind,
    ownerOrgId: string | null,
    currency: string,
  ): Promise<string> {
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO ledger_accounts (kind, owner_org_id, currency)
      VALUES (${kind}, ${ownerOrgId}, ${currency})
      ON CONFLICT (kind, owner_org_id, currency) DO NOTHING
      RETURNING id
    `);
    const insertedId = inserted.rows[0]?.id;
    if (insertedId !== undefined) return insertedId;

    const found = await tx.execute<{ id: string }>(sql`
      SELECT id FROM ledger_accounts
      WHERE kind = ${kind}
        AND currency = ${currency}
        AND owner_org_id IS NOT DISTINCT FROM ${ownerOrgId}
    `);
    const id = found.rows[0]?.id;
    if (id === undefined) {
      throw new Error(`Could not resolve ledger account ${kind} for ${ownerOrgId ?? 'platform'}`);
    }
    return id;
  }
}

/**
 * A transaction's headline amount is the sum of its DEBITS, which for a
 * balanced set equals the sum of its credits. Summing everything would give
 * zero, which is true and useless as a display value.
 */
function debitTotal(entries: readonly Entry[]): number {
  return entries.reduce((acc, e) => (e.amount.amount > 0 ? acc + e.amount.amount : acc), 0);
}
