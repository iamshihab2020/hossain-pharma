import { bigint, char, check, index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

/**
 * PLATFORM-OWNED, all of it, and that is a decision rather than an omission.
 *
 * One checkout produces ONE payment intent covering several sellers, and one
 * capture posts ledger entries against two sellers' payable accounts and the
 * platform's revenue account in a single transaction. Under RLS with a tenant
 * GUC set, that write is impossible: whichever tenant is selected, the other
 * sellers' rows fail WITH CHECK. Making it work would need a third
 * tenant-scope escape, and `common/tenant-scope.ts` says to stop and ask first.
 *
 * Asking gives the right answer: these are the PLATFORM's books, not any
 * seller's data. A seller reads their own payable balance through an
 * `owner_org_id` filter in the service - the `saved_searches` pattern, where
 * the filter is the only boundary and is tested as one. See ADR 0016.
 */

/**
 * PRD 11 Phase 4: "Webhook is the only writer of payment status."
 *
 * `POST /checkout/confirm` creates the intent as REQUIRES_PAYMENT (or
 * COD_PENDING) and never advances it, even for the mock adapter that could
 * succeed synchronously. `PaymentWebhookService.apply()` is the sole caller of
 * the transition.
 */
export const paymentIntentStatus = pgEnum('payment_intent_status', [
  'REQUIRES_PAYMENT',
  'COD_PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buyerUserId: uuid('buyer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Which adapter owns this intent: 'mock', 'cod', 'stripe'. */
    provider: text('provider').notNull(),
    status: paymentIntentStatus('status').notNull().default('REQUIRES_PAYMENT'),
    amountTotal: bigint('amount_total', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    /** The gateway's own identifier, for reconciliation. */
    providerRef: text('provider_ref'),
    /**
     * PRD 13: idempotency keys on all mutating endpoints. Unique, so a
     * double-submitted checkout returns the original orders instead of placing
     * a second set - enforced by the database rather than by a prior SELECT
     * that two concurrent requests would both pass.
     */
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('payment_intents_amount_positive', sql`${t.amountTotal} > 0`),
    unique('payment_intents_idempotency_key').on(t.idempotencyKey),
    index('payment_intents_buyer_idx').on(t.buyerUserId),
  ],
);

/**
 * Webhook idempotency as a UNIQUE CONSTRAINT, not a lookup.
 *
 * The handler inserts here FIRST; a 23505 means "already applied" and returns
 * 200 without re-posting. A prior `SELECT ... WHERE provider_event_id = $1`
 * would let two concurrent deliveries of the same retry both find nothing and
 * both post, which is how a gateway retry becomes a double capture.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    intentId: uuid('intent_id').references(() => paymentIntents.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('payment_events_provider_event_key').on(t.provider, t.providerEventId)],
);

/**
 * COD_ACCRUAL is Phase 4's placeholder posting; Phase 6 collects against it.
 * FULFILMENT is a dispatch releasing one shipment's share from clearing to the
 * seller's payable. REFUND covers a cancellation's reversal - ADR 0016 said
 * refunds would need no schema change, and Phase 5 confirmed it.
 */
export const transactionKind = pgEnum('transaction_kind', [
  'CAPTURE',
  'REFUND',
  'COD_ACCRUAL',
  'FULFILMENT',
]);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentIntentId: uuid('payment_intent_id')
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'restrict' }),
    kind: transactionKind('kind').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('transactions_intent_idx').on(t.paymentIntentId)],
);
