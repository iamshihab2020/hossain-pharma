# @nexmarket/mongo-etl

Migrates the legacy MongoDB data into the relational schema. Ships as a
standalone, tested script rather than a one-off: PRD 12 chose greenfield with
seed data, so nothing depends on this running, but "migrated a document store to
a relational schema" is real portfolio surface and the hazards below are real
findings from the legacy data.

## Stages

| Stage | File | Status |
|---|---|---|
| 1 · Extract | `src/extract.ts` | shipped |
| 2 · Transform | `src/transform.ts` | shipped, 19 tests |
| 3 · Load | not yet | **Phase 4** |
| 4 · Verify | `src/verify.ts` | partial |

The **load stage lands with Phase 4**, not now: it cannot insert orders,
shipments and ledger entries into tables that do not exist yet. Verify likewise
gains referential-integrity and ledger-balance checks then.

## Source collections

Eight, confirmed by reading `archive/old-code/server-side/index.js`:
`user`, `products`, `category`, `cart`, `ads`, `approvedAds`, `payments`,
`invoice`.

They expand to roughly 42 tables. That expansion **is** the migration - see PRD
8.1 for the full mapping. The headline ones:

- `products` splits into `products` (platform catalogue entry) and `listings`
  (a seller's offer), which is what makes multi-seller comparison possible at all
- `payments` splits into `orders`, `order_items`, `shipments`,
  `payment_intents`, `transactions`, `ledger_entries`, `ledger_accounts`
- `user.role` becomes `org_members` rows, so one person can hold different roles
  in different seller organisations

## Known hazards, and where each is handled

All five are real properties of the legacy data, not hypotheticals.

| Hazard | Handling | Where |
|---|---|---|
| `cart._id` values like `temp-1699999999999` are not ObjectIds and `new ObjectId()` throws on them | quarantine the row, do not crash | `isMigratableObjectId`, tested |
| `approvedAds` duplicates rows already in `ads`; the legacy delete handler removed from the wrong collection, leaving orphaned approvals | dedupe on load into one table with a status enum, keeping orphans | `dedupeAds`, tested |
| Float prices need deterministic rounding to minor units | round half away from zero, reconcile in verify | `toMinorUnits`, tested |
| Users with no `role` | default to buyer-only | `normaliseRole`, tested |
| Orphaned `cartIds` in `payments` | log, not fatal | load stage, Phase 4 |

On rounding: the legacy server did `parseInt(price * 100)`, which **truncates**.
`19.99 * 100` is `1998.9999999999998` in IEEE 754, so it charged 1998. This ETL
rounds instead, so migrated totals can differ from legacy totals by a paisa per
line. That difference is reported by verify rather than hidden.

**Prescription-only legacy products are dropped, not migrated**, and reported.
NexMarket is a universal marketplace and regulated-health flows are explicitly
out of scope (PRD 4.2). Legacy pharma products that are not prescription-only
map into `Health & Beauty`.

## Running it

```bash
export LEGACY_MONGO_URL=mongodb://localhost:27017
export LEGACY_MONGO_DB=hossainPharma
pnpm --filter @nexmarket/mongo-etl run etl
```

Both variables are required; the script exits non-zero without them. Neither is
needed for anything else in the repo.
