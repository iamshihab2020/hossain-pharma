import { bigint, char, check, index, pgEnum, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { transactions } from './payments.js';

/**
 * The double-entry ledger. PLATFORM-OWNED - see the note in payments.ts.
 *
 * APPEND-ONLY, enforced by privilege rather than by discipline: migration 0012
 * grants `nexmarket_app` SELECT and INSERT on `ledger_entries` and nothing
 * else. A mistake is corrected by posting a reversing transaction, which is
 * also why refunds (Phase 8) need no schema change.
 */

/** Mirrors ACCOUNT_KINDS in @nexmarket/shared/ledger.ts. Keep them in step. */
export const ledgerAccountKind = pgEnum('ledger_account_kind', [
  'BUYER_RECEIVABLE',
  'PLATFORM_CLEARING',
  'SELLER_PAYABLE',
  'PLATFORM_REVENUE_COMMISSION',
  'COD_RECEIVABLE',
]);

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: ledgerAccountKind('kind').notNull(),
    /** Set for SELLER_PAYABLE only; null for every platform-wide kind. */
    ownerOrgId: uuid('owner_org_id').references(() => organisations.id, { onDelete: 'restrict' }),
    currency: char('currency', { length: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * NULLS NOT DISTINCT is load-bearing.
     *
     * Postgres treats NULLs as distinct in a unique constraint by default, so
     * without this every platform-wide account - all four kinds that carry no
     * owner - could be created an unlimited number of times, and
     * `balanceFor('PLATFORM_CLEARING')` would silently read one of several
     * partial balances. Requires Postgres 15+; compose pins 16.
     */
    unique('ledger_accounts_identity_key')
      .on(t.kind, t.ownerOrgId, t.currency)
      .nullsNotDistinct(),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    /**
     * SIGNED minor units: positive debits, negative credits, so the balance
     * invariant is literally SUM(amount) = 0 per transaction.
     *
     * A `direction` enum with positive amounts reads better in a row viewer but
     * turns every balance check into a CASE expression, and every place that
     * forgets the CASE produces a wrong number that still looks like a number.
     * The readable rendering is a view, not the storage. ADR 0016.
     */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** A zero posting is always a bug, never a rounding result. */
    check('ledger_entries_nonzero', sql`${t.amount} <> 0`),
    index('ledger_entries_transaction_idx').on(t.transactionId),
    index('ledger_entries_account_idx').on(t.accountId),
  ],
);
