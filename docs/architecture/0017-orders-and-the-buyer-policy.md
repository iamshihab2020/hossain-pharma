# ADR 0017 - Orders: the buyer policy, the third tenant-scope escape, and price tampering

**Status:** accepted
**Date:** 2026-09-04
**Phase:** 4
**Implements:** PRD 9.1 (Cart & checkout), 11 Phase 4, 13 (idempotency, optimistic locking).

## Context

An order belongs to exactly one seller - a cart spanning three sellers produces
three orders - so `orders` and `order_items` are tenant-owned. But the person
who creates them is a **buyer**, who is not a tenant, and who must later read
their orders **across every seller**.

Those two requirements pull in opposite directions on one table.

## Decision 1: `own_orders`, gated - the pattern's third appearance

```sql
CREATE POLICY own_orders ON orders FOR SELECT USING (
  NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  AND buyer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
);
```

A seller sends `x-tenant-id` and `tenant_isolation` applies. A buyer sends no
tenant, so `own_orders` applies, keyed on `app.user_id` - the GUC ADR 0011 added
for the membership bootstrap, and this is its second reader.

**The `IS NULL` gate is the whole of it.** Postgres ORs permissive policies, so
without it a seller reading their own orders would also match `own_orders`. That
is the bug migration 0006 fixed on `org_members` and 0008 on `listings`,
arriving a third time. `orders-rls.test.ts` is mutation-verified: deleting the
gate makes seller A see two orders instead of one.

`FOR SELECT` and no `WITH CHECK`, deliberately. A buyer may **read** their
orders without a tenant; they must never be able to **insert** one. An order row
is what a seller's fulfilment queue reads, so a buyer-insert policy would be a
way to make a stranger ship goods.

**The rule is now stated once and for all: a second permissive policy on a
tenant-owned table widens every tenant-scoped read until a gate and a test say
otherwise.**

## Decision 2: a third tenant-scope escape, and the two rejected alternatives

If a buyer cannot insert an order, how does checkout write one? It writes to
four tenant-owned tables - `orders`, `order_items`, `inventory_items`,
`listings` - across several sellers, in one transaction.

Three options:

| Option | Why not |
|---|---|
| Run the whole checkout as a platform admin | One character's difference, and it hands a **buyer's** transaction unrestricted read access to every tenant's rows for its duration, to solve a narrow write problem |
| Add a buyer-insert policy on `orders` | Lets a buyer forge an order attributed to themselves against any seller - see above |
| Switch into ONE seller's scope for exactly their writes | Narrowest, and what `asTenantScope` was built for |

The third wins. `common/tenant-scope.ts` now documents **three** call sites
rather than two, and the safety rule still holds: `group.sellerId` is
`listings.tenant_id`, read from the database inside the transaction. **The buyer
chose a listing, never a tenant**, so no caller-supplied value reaches the call.

The payment webhook is the exception that proves it: it runs with
`isAdmin: true`, because it is server-to-server, authenticated by an HMAC, and
must move every order on one intent to PAID. The difference is who is driving.

## Decision 3: `expectedTotal` is a comparison, never an input

PRD 11 Phase 4 requires "price tampering rejected". The design makes it
unrepresentable rather than rejected:

- `cart_items` has **no money column at all**, asserted by reflecting over
  `information_schema.columns` - a test that only checked a response would still
  pass the day someone added `unit_price` "for convenience";
- `QuoteService` computes every amount from `listings` inside the request
  transaction;
- `POST /checkout/confirm` takes `expectedTotal` and **compares** it.

A mismatch is **409 `PRICE_CHANGED`** carrying the new quote, not 400: the
common cause is a seller repricing mid-checkout, and the client's correct
response is to re-render, not to retry. The acceptance test asserts that after a
tampered confirm there are **zero orders and zero ledger entries** - not merely
that an error came back.

`expectedTotal` is required rather than optional. Optional means a client that
omits it gets whatever the server decides, which is the "silently charged more
than the page said" failure wearing a different hat.

## Decision 4: reservation is a conditional UPDATE, and the first one was wrong

PRD 13 asks for optimistic locking on inventory. The cheapest correct form is a
single statement where the check and the write cannot be separated.

**The first version was subtly broken and the CHECK constraint caught it:**

```sql
-- WRONG
UPDATE inventory_items SET reserved = reserved + $qty
 WHERE id = (SELECT id FROM inventory_items
              WHERE listing_id = $1 AND (on_hand - reserved) >= $qty LIMIT 1);
```

Postgres evaluates the subquery against the **pre-lock snapshot**. The second
transaction blocks on the row; when it resumes it re-checks only the outer
`WHERE`, which said nothing but `id = ...` - still true. Both checkouts took the
last unit, and `reserved <= on_hand` from migration 0008 turned it into a 500.

```sql
-- RIGHT
UPDATE inventory_items SET reserved = reserved + $qty
 WHERE id = (SELECT id FROM inventory_items
              WHERE listing_id = $1 AND (on_hand - reserved) >= $qty
              ORDER BY (on_hand - reserved) DESC LIMIT 1 FOR UPDATE)
   AND (on_hand - reserved) >= $qty;
```

`FOR UPDATE` takes the lock inside the subquery; repeating the predicate outside
is what gets re-evaluated afterwards. **Both halves are load-bearing**, and the
test asserts exactly one of two concurrent checkouts wins.

`SELECT ... FOR UPDATE` around the whole transaction would also be correct and
would serialise every checkout on a popular listing for its full duration.

## Decision 5: orders snapshot everything

`order_items` stores the product name, SKU, unit price, commission **rate** and
commission amount as they were on the day. The listing may be repriced, renamed
or archived tomorrow; an order rendering "unknown product" is a support ticket,
and one whose total follows today's price is a dispute. `listing_id` is
`ON DELETE RESTRICT` for the same reason: a seller archiving an offer must not
delete the evidence of what was sold.

The shipping address is a `jsonb` snapshot rather than a foreign key, so an
address edited next year cannot restate where last year's parcel went.

The age gate stores `age_verified_at` - a timestamp - and **never the date of
birth**. PRD 13 minimises PII, and a birth date retained to prove an 18+ check
is more data than the check needs. The test asserts no column on `orders` even
matches `%birth%`.

## Related

- `packages/db/migrations/0012_commerce_rls.sql`
- `apps/api/src/modules/checkout/`, `modules/orders/`, `common/tenant-scope.ts`
- `packages/db/src/orders-rls.test.ts`, `apps/api/test/checkout.e2e.test.ts`
- ADR 0011 (`app.user_id`), 0016 (the ledger), 0018 (the payment port)
