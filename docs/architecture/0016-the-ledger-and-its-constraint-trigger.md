# ADR 0016 - The ledger: signed entries, a deferred trigger, and why it is platform-owned

**Status:** accepted
**Date:** 2026-09-04
**Phase:** 4
**Implements:** PRD 10.1 (Payments - port + ledger), 8.4 (Money), 13 (100 % on ledger).

## Context

PRD 10.1 makes the ledger the source of truth and lists four invariants:
entries sum to zero, no negative seller balance without an adjustment, refunds
never exceed the capture, and concurrent writes to one account serialise. The
first is the one everything else rests on.

## Decision 1: entries carry a SIGNED amount, debit positive

`ledger_entries.amount` is a signed `bigint` in minor units. The balance rule is
then literally `SUM(amount) = 0`.

Rejected: a `direction` enum with positive amounts. It reads better in a row
viewer and turns every balance check into
`SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END)`. Every place
that forgets the `CASE` produces **a wrong number that still looks like a
number**, and by Phase 10 - payouts, statements, analytics - there will be many
such places. The readable rendering belongs in a view, not in the storage.

## Decision 2: the balance is enforced by a DEFERRED CONSTRAINT TRIGGER

`assertBalanced()` in `@nexmarket/shared` validates before `LedgerService.post`
writes anything, and is covered to 100 %. That is not enough. It is one
function, and nothing stops a service written next year from calling
`tx.insert(ledgerEntries)` directly. **"We always call the helper" is a claim no
test can make about code that does not exist yet.**

So migration 0012 adds a `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`
that re-checks `SUM(amount) = 0` per transaction **at commit**.

`DEFERRABLE INITIALLY DEFERRED` is load-bearing: entries are inserted one
statement at a time and are legitimately unbalanced between them. A non-deferred
trigger would reject every transaction on its first row. The test asserts
exactly this - the inserts succeed, the **commit** fails.

**This does not contradict Phase 3's rejection of triggers for the search
index.** That rejection stands, and the distinction is assertion versus side
effect: a search trigger would have *written data* invisibly from the call site,
whereas this one writes nothing and can only refuse. An invariant that cannot be
bypassed is the entire reason a ledger is trusted.

Three enforcement layers, deliberately: the pure function for a fast and precise
failure, the trigger for one that cannot be bypassed, and a
`CHECK (amount <> 0)` for the degenerate case, because a zero posting is always
a bug and never a rounding result.

## Decision 3: the ledger is PLATFORM-OWNED, and no third escape hatch

One capture posts entries against two sellers' payable accounts and the
platform's revenue account **in a single transaction**. Under RLS with a tenant
GUC set that write is impossible: whichever tenant is selected, the other
sellers' rows fail `WITH CHECK`.

Making it work would have needed a third `tenant-scope.ts` escape, and that file
says to stop and ask first. Asking gave the answer: **these are the platform's
books, not any seller's data.** So `ledger_accounts`, `ledger_entries`,
`transactions`, `payment_intents` and `payment_events` carry no row-level
security, and a seller reads their own payable through an `owner_org_id` filter
in the service - the `saved_searches` pattern, where the filter is the only
boundary and is tested as one.

`balanceFor(tx, kind, ownerOrgId, currency)` takes the owner as a **required
argument** rather than an optional filter, so omitting it is a type error rather
than a silent cross-seller read.

## Decision 4: append-only by PRIVILEGE, and the grant that was a no-op

`ledger_entries` and `transactions` are never updated or deleted. A mistake is
corrected by posting a reversing transaction, which is also why refunds
(Phase 8) need no schema change.

The first version of migration 0012 wrote
`GRANT SELECT, INSERT ON ledger_entries TO nexmarket_app` and **that did
nothing**. Migration 0001 had already run

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexmarket_app;
```

so every table created afterwards already carries all four privileges. A
narrower `GRANT` is purely additive: it reads like a restriction and removes
nothing. Verified against the live database, which reported
`DELETE, INSERT, SELECT, UPDATE`.

**Making a table append-only requires an explicit `REVOKE`.** The tests assert
that `UPDATE` and `DELETE` are refused with SQLSTATE 42501, because a comment
claiming immutability over a role that can `UPDATE` is worse than neither.

## What that cost: the upsert had to change

`INSERT ... ON CONFLICT DO UPDATE SET kind = EXCLUDED.kind` is the usual way to
make an upsert return its row on conflict, and it **requires the UPDATE
privilege** - which is exactly what the revoke removes. The two are in direct
tension and the upsert is the half that yields:

```sql
INSERT INTO ledger_accounts (kind, owner_org_id, currency)
VALUES ($1, $2, $3) ON CONFLICT (kind, owner_org_id, currency) DO NOTHING
RETURNING id;
-- then, if that returned nothing, SELECT the row the winner inserted
```

Still race-safe, and it needs only INSERT and SELECT. `IS NOT DISTINCT FROM`
rather than `=` on `owner_org_id`, because it is NULL for every platform-wide
kind and `NULL = NULL` is NULL.

`ledger_accounts` is `UNIQUE NULLS NOT DISTINCT (kind, owner_org_id, currency)`.
Without `NULLS NOT DISTINCT`, Postgres treats NULLs as distinct and every
platform-wide account could be created without limit, making
`balanceFor('PLATFORM_CLEARING')` a partial balance nobody would notice was
partial.

## Decision 5: what placement posts, and what it does not

A **card** order posts nothing at placement. No money has moved, and a ledger
that recorded intent would overstate receivables for every abandoned checkout.
The capture entries come from the webhook.

A **cash-on-delivery** order posts at placement, against `COD_RECEIVABLE`,
because the obligation is real the moment the parcel is dispatched even though
the cash is days away. **COD is why this ledger earns its place** (PRD 10.1):
money arrives late, sometimes partially, sometimes never, and a single balance
column has nowhere truthful to put that.

## Related

- `packages/db/migrations/0012_commerce_rls.sql`
- `packages/shared/src/ledger.ts`, `pricing.ts` - 100 % covered
- `apps/api/src/modules/ledger/ledger.service.ts`
- `packages/db/src/ledger-constraints.test.ts`, `apps/api/test/ledger.e2e.test.ts`
- ADR 0017 (orders and the buyer policy), 0018 (the payment port)
