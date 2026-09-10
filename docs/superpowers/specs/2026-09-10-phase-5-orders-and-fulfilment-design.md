# Phase 5 — Orders & Fulfilment: design

**Status:** proposed
**Date:** 2026-09-10
**Spec:** `docs/PRD-marketplace-migration.md` §9.2 "Order fulfilment" (seller),
§9.1 (buyer order history), §11 Phase 5, §10.1 (ledger), §13 (optimistic
locking, PII minimisation).

**Acceptance (PRD §11):** a partial shipment settles correctly in the ledger; a
seller sees only their items on a shared order.

**Demo:** fulfil one seller's half of an order while the other half stays pending.

---

## 1. What this phase decides

Phase 4 ends with an order that is `PAID` and then never moves again. The
`order_status` enum says so in a comment: *"the states absent here are absent
because nothing can reach them yet"*. Phase 5 is the rest of that enum, the
tables that justify each state, and the money that moves with them.

Four decisions were taken before design and are inputs here, not open questions:

| Decision | Consequence |
|---|---|
| **A seller's payable becomes real on dispatch**, per shipment | `captureEntries` stops crediting `SELLER_PAYABLE`; a new release posting does it |
| **Cancellation reverses the ledger now; the gateway refund waits for Phase 8** | A `REFUND` transaction is posted; `PaymentProvider` grows no new method |
| **Ship the API plus two screens** — buyer timeline, seller queue | `apps/web` gains a seller surface for the first time |
| **Documents are print views; carrier is data; labels are dropped** | No PDF library; `ShippingProvider` stays Phase 6 |

Everything below follows from those four and from what the database already
enforces.

---

## 2. The state machine

### States

`order_status` gains five values. The three that exist keep their meaning.

```
PENDING_PAYMENT ──pay──► PAID ──accept──► ACCEPTED ──ship──► PARTIALLY_SHIPPED
      │                   │  │                │                    │
      │                   │  └──reject──► REJECTED                 │ ship rest
    cancel              cancel               (terminal)            ▼
      │                   │                │                    SHIPPED
      ▼                   ▼                ▼                       │
   CANCELLED ◄────────────┴────────────────┘                    deliver
   (terminal)                                                       ▼
                                                               DELIVERED
                                                               (terminal)
```

- **`ACCEPTED`** — the seller has taken the order on. Separate from `PAID`
  because "we have your money" and "we will send this" are different promises,
  and the gap between them is the seller's to answer for.
- **`REJECTED`** — the seller declined before accepting. **A distinct state, not
  `CANCELLED` with an actor recorded.** A buyer reading their history must be
  able to tell "I cancelled this" from "the seller would not fulfil it" without
  reading an event log, and Phase 7 will want a rejection rate per seller.
- **`PARTIALLY_SHIPPED` / `SHIPPED`** — derived from line coverage, never set by
  hand. See §2.3.
- **`DELIVERED`** — every shipment delivered. Seller-reported for now; Phase 6
  replaces the trigger with carrier tracking events and this state does not move.

### 2.1 Who may drive each transition

| Transition | Actor | Enforcement |
|---|---|---|
| `PENDING_PAYMENT → PAID` | the payment webhook | unchanged; ADR 0018 — the webhook remains the only writer of `payment_intents.status` |
| `PAID → ACCEPTED` / `→ REJECTED` | seller | `@RequireCapability('order:write')` |
| `→ PARTIALLY_SHIPPED` / `→ SHIPPED` | seller, by creating a shipment | same capability; the status is a consequence, not a request |
| `SHIPPED → DELIVERED` | seller | same capability |
| `→ CANCELLED` | buyer **or** seller | buyer: owns the order and nothing has dispatched. Seller: `order:write` |

No transition is expressible as "set status to X". The API exposes verbs —
`accept`, `reject`, `shipments`, `deliver`, `cancel` — and the status column is
computed from what those verbs did.

### 2.2 Against the PRD's state list

PRD §9.2 names `CONFIRMED → PACKED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED`.
This design ships a different set, and each difference is deliberate:

| PRD | Here | Why |
|---|---|---|
| `CONFIRMED` | `ACCEPTED` | Same state. Renamed to match the verb in the PRD's own bullet directly above it — "accept / reject with reason" — because a status whose name does not match the button that causes it is a translation everyone has to keep doing |
| `PACKED` | — | **Dropped.** No money moves, no inventory moves, and a buyer cannot tell it from `ACCEPTED`. It is a warehouse-workflow state, and this codebase has no warehouse workflow until Phase 6 gives it warehouses that allocate |
| `OUT_FOR_DELIVERY` | — | **Deferred to Phase 6.** It is a carrier tracking event, and inventing it as a seller-clicked button now means Phase 6 arrives to find a hand-set column competing with a real event feed |
| — | `PARTIALLY_SHIPPED` | **Added.** Phase 5's acceptance criterion is a half-fulfilled order; the PRD's linear list has nowhere to put one |
| — | `REJECTED` | **Added**, see above |

If `PACKED` earns its place later — a picking workflow, an SLA clock that starts
there — it is one enum value and one verb. Adding it now would be a state whose
only current function is to be passed through.

### 2.3 The transition table is a pure module

`packages/shared/src/order-state.ts`, joining `money.ts`, `capabilities.ts`,
`buy-box.ts`, `tenant-context.ts` and `assert-driver.ts` on the **100 % coverage
threshold list** in `packages/shared/vitest.config.ts` and in CLAUDE.md.

Two functions, both pure:

```ts
export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean
export function statusFromCoverage(coverage: LineCoverage[], current: OrderStatus): OrderStatus
```

`statusFromCoverage` is the one that matters. Given, for each line, its ordered
quantity, its shipped quantity and its cancelled quantity, it answers what the
order's status now is:

- nothing shipped, nothing cancelled → unchanged
- every unit either shipped or cancelled, and at least one shipped → `SHIPPED`
- every unit cancelled → `CANCELLED`
- some shipped, some outstanding → `PARTIALLY_SHIPPED`

Putting it in `shared` rather than in the service is the same argument
`buy-box.ts` makes: the interesting logic is arithmetic over a small input, it
has edge cases worth exhausting (a fully-cancelled order, a line cancelled after
a partial shipment, a zero-quantity shipment), and a database is not needed to
test any of them.

---

## 3. Schema

Three new tables, one new column, two enum extensions. Migration numbering
continues at `0013_fulfilment_tables.sql` and `0014_fulfilment_rls.sql`, both
created with `drizzle-kit generate --custom` so the file, journal entry and
snapshot are written together — a hand-dropped `.sql` is silently ignored.

### 3.1 `shipments` — tenant-owned

```
id, tenant_id, order_id, shipment_number (unique, per-seller human-facing),
status ('DISPATCHED' | 'DELIVERED'),
carrier_name text, tracking_number text (both nullable — a seller may hand a
  parcel to a rider with neither),
release_amount bigint, release_commission bigint, currency char(3),
dispatched_at, delivered_at, created_at, updated_at
```

**Creating a shipment *is* the dispatch.** There is no `DRAFT` state: a draft
shipment is a picking list, nobody has asked for one, and a state that exists
only to be left behind is a state every query has to remember to exclude.

`release_amount` and `release_commission` are **stored, not recomputed on read**.
They are the amounts this shipment actually posted to the ledger, and the ledger
is append-only; a column that could disagree with a posted entry after a rounding
change would make the books arguable. This is the opposite of the
`available_stock` rule and for the same underlying reason — there, the source of
truth is the inventory rows and the column is a cache; here, the source of truth
*is* this row, because the entries it produced can never be edited.

### 3.2 `shipment_items` — tenant-owned

```
id, tenant_id, shipment_id, order_item_id, quantity (> 0)
```

`tenant_id` is denormalised for the same reason it is on `order_items`: RLS
governs this table without joining two levels up.

**Shipped quantity is never stored on `order_items`.** It is
`SUM(shipment_items.quantity)`. A denormalised counter here would have two
writers — dispatch and cancellation — which is exactly the drift CLAUDE.md
warns about on `available_stock`.

### 3.3 `order_events` — tenant-owned, append-only

```
id, tenant_id, order_id, buyer_user_id (denormalised),
type (enum: PLACED | PAID | ACCEPTED | REJECTED | SHIPMENT_DISPATCHED |
      SHIPMENT_DELIVERED | LINES_CANCELLED | CANCELLED),
actor ('BUYER' | 'SELLER' | 'SYSTEM'), actor_user_id (nullable),
payload jsonb, created_at
```

The buyer timeline is history, and a status column has none. `payload` carries
the shipment id, the carrier, the cancelled quantities, the rejection reason —
whatever the type needs — because a timeline entry that says only `SHIPPED` is a
worse answer than the one the buyer already has.

**Append-only by `REVOKE`, not by `GRANT`.** Migration 0001 ran
`ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE`, so every new
table already carries all four and a narrower grant removes nothing — the lesson
ADR 0016 paid for. The migration must
`REVOKE UPDATE, DELETE ON order_events FROM nexmarket_app`, and a test must
assert SQLSTATE 42501 on both.

`buyer_user_id` is denormalised so the buyer's gated policy is a column
comparison rather than an `EXISTS` through `orders`. `order_items` uses the
`EXISTS` form; this table is read on every timeline render, which is the buyer's
most-visited authenticated page.

### 3.4 `order_items.cancelled_quantity`

`integer NOT NULL DEFAULT 0`, with `CHECK (cancelled_quantity >= 0)`. Stored
rather than derived, because unlike shipped quantity there is no child table to
sum — a cancellation is not an object, it is a fact about a line. Its single
writer is `FulfilmentService`.

### 3.5 Enum extensions

```sql
ALTER TYPE order_status ADD VALUE 'ACCEPTED';        -- and REJECTED,
ALTER TYPE order_status ADD VALUE 'PARTIALLY_SHIPPED'; -- SHIPPED, DELIVERED
ALTER TYPE transaction_kind ADD VALUE 'FULFILMENT';
```

`ALTER TYPE ... ADD VALUE` is permitted inside a transaction on PG 12+, but the
new value **cannot be used in the same transaction that adds it**. The migration
only adds; nothing in it references the new values. Worth stating because the
failure mode is a migration that passes locally and dies on a fresh database.

`transaction_kind` already carries `REFUND`, so cancellation needs no enum change
— ADR 0016 said refunds would need no schema change and this is the first
occasion to find out whether that was true. It was.

### 3.6 The over-shipment constraint trigger

Per order item, `shipped + cancelled <= quantity`. This cannot be a table
`CHECK` — it spans rows in another table — so it is a
`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` on `shipment_items` and
`order_items`, re-checking the invariant at commit.

Same justification ADR 0016 gives for the ledger balance, and it is worth
restating because Phase 3 rejected triggers for the search index and the
distinction is the whole argument: **this trigger asserts and can only refuse; it
never writes.** A trigger that wrote data invisibly from the call site is still
rejected. And "the service always checks first" is a claim no test can make about
a service that does not exist yet.

The service still checks — with the conditional-UPDATE shape from ADR 0017
Decision 4, predicate inside the `FOR UPDATE` subquery **and repeated outside**,
because Postgres re-checks only the outer `WHERE` after taking the lock. Two
concurrent dispatches of the last unit must produce one shipment and one 409.
Both halves are load-bearing; the trigger is the backstop, not the check.

---

## 4. RLS

Three new tenant-owned tables, so `ENABLE` + `FORCE` + policies, copying the
shape of `0012_commerce_rls.sql`, `NULLIF(...)::uuid` wrapper included.

Each table gets three policies:

1. `tenant_isolation` — `USING` and `WITH CHECK` on `tenant_id`
2. `platform_admin_bypass` — on `app.is_admin`
3. a gated buyer `SELECT` policy — `own_shipments`, `own_shipment_items`,
   `own_order_events`

Every one of the third kind carries the gate:

```sql
NULLIF(current_setting('app.tenant_id', true), '') IS NULL AND ...
```

**Assume each of these has the widening bug until a test says otherwise.** It has
now bitten on `org_members` (0006), `listings` (0008) and `orders` (0012); this
phase adds three more chances and the tests must be mutation-verified the way
`orders-rls.test.ts` is — delete the gate, watch seller A see seller B's rows,
put it back.

`FOR SELECT` and **no `WITH CHECK`** on all three. A buyer reads shipments; a
buyer must never insert one. An inserted shipment is a claim that goods were
dispatched, which is a claim about money now that dispatch releases payables.

---

## 5. Money

### 5.1 Capture stops paying sellers

`captureEntries` currently posts, per seller: `PLATFORM_CLEARING` debit,
`SELLER_PAYABLE` credit, `PLATFORM_REVENUE_COMMISSION` credit. Those three come
out. What remains is:

```
DR  buyer_receivable    total
CR  platform_clearing         total
```

The seller's money sits in clearing — which is what clearing is for, and what
`ledger.ts` already says it is for: *"money received but not yet attributed —
which is exactly the state COD spends days in."* Dispatch is the attribution.

The signature changes from `captureEntries(splits)` to `captureEntries(total)`.
The per-seller argument no longer has a job at capture time, and keeping it
"for symmetry" would leave a parameter that must be right for no reason.

**Card and COD now converge.** COD already posts only
`COD_RECEIVABLE` / `PLATFORM_CLEARING` at placement (ADR 0016 Decision 5). After
this change both methods leave the seller's gross in clearing and both release it
the same way, through the same code path. The payment method stops being visible
to fulfilment at all, which is the property that makes Phase 6's COD collection a
posting against `COD_RECEIVABLE` and nothing else.

### 5.2 Dispatch releases

Per shipment, one `FULFILMENT` transaction:

```
DR  platform_clearing              release_amount
CR  seller_payable:<org>                  release_amount − release_commission
CR  platform_revenue:commission            release_commission
```

Suppressing zero-amount entries as `captureEntries` already does — `amount <> 0`
is a CHECK constraint, and a zero posting is always a bug.

### 5.3 How the share is computed, and why `allocate()` finally earns it

`gross` in a capture is `order.total` — subtotal **plus order-level shipping and
tax**. A shipment carries some units, not some fraction, so the release is an
amount computed once at order level and then split. That is the exact condition
`allocate()` was written for and has been waiting for since Phase 4, where F-1 of
the plan concluded it belonged to "a cart-wide promotion (Phase 9) or a partial
refund (Phase 8)". A partial shipment got there first.

**Recomputing the share from the shipped lines is wrong, and cheaply so:**

```
unit price 1, quantity 3, line total 3, commission 5000 bps
  stored commission_amount = commissionFor(3, 5000) = multiply(3, 0.5) = 1.5 → 2
  ship one unit at a time, recomputing each:
    commissionFor(1, 5000) = 0.5 → 1, three times = 3
```

The platform takes 3 where it recorded 2. Every rounding boundary does this, in
whichever direction the last unit falls, and nothing fails — the entries balance,
the trigger is satisfied, and the number is simply wrong.

So: **allocate `order.total` across the order's individual units once**, weighted
by unit price, and let each shipment release the sum of its own units' shares.
Same for `order.commission_amount`. Two properties fall out:

- the parts sum to the recorded whole by construction, so the final shipment
  closes the order to zero outstanding with no remainder to chase;
- a shipment's amount is a **sum of fixed per-unit shares**, never a fresh
  rounding, so no rounding boundary is crossed twice.

Units are consumed in index order, where a line's next free index is
`shipped + cancelled` for that line. A shipment's amount therefore depends on
which unit indices it takes - the `allocate()` remainder lands on the earliest
units - and is recomputable from persisted state at any time. It is also stored
on the shipment row (§3.1), so the books never have to recompute it at all.

Rejected: recomputing each shipment's share as a fresh percentage of the value
it carries — the counterexample above. It looks exact, and the failure is silent:
the entries balance, the constraint trigger is satisfied, and the platform's take
is simply not the number the order recorded.

Also rejected: giving the **last** shipment whatever remainder is left. It
reaches the same total, but it puts the correction in the one place nobody
audits, and "the last parcel is where the rounding lives" is a rule that
survives exactly until an order is cancelled mid-way.

### 5.4 Cancellation reverses

A `REFUND` transaction reversing exactly the cancelled units' allocated shares:

```
DR  platform_clearing            cancelled share
CR  buyer_receivable                    cancelled share
```

Sellers are untouched, because their payable was never credited for units that
never dispatched. That is the whole benefit of the dispatch-release decision
showing up on its first use.

The buyer is now owed money, and the ledger says so as a balance anyone can
query. Returning it through the gateway is Phase 8, which will add `refund` to
`PaymentProvider` and a webhook event for its lifecycle. **`PaymentProvider`
grows no method in this phase** — a half-built refund path is worse than an
honest ledger and no path.

### 5.5 What must remain true

Every existing ledger invariant test still passes unchanged; they assert balance,
not composition. Two new ones:

- ship an order in two halves → the two `FULFILMENT` transactions' seller
  payables sum **exactly** to what a single full capture would have paid, for a
  case chosen to round badly;
- cancel the unshipped remainder of a partially shipped order → clearing returns
  to zero for that order and the buyer receivable equals what was shipped.

---

## 6. Inventory and search

Checkout increments `inventory_items.reserved`. Fulfilment is where those
reservations resolve:

| Event | Inventory | `available = on_hand − reserved` | Reindex? |
|---|---|---|---|
| Dispatch | `on_hand −= qty`, `reserved −= qty` | **unchanged** | no |
| Cancel a line | `reserved −= qty` | increases | **yes** |
| Reject an order | as cancelling every line | increases | **yes** |

Dispatch not needing a reindex is a real result, not an oversight: the goods left
the shelf and left the reservation at the same moment, so what a buyer can buy
did not change. Worth a comment at the call site, because the next reader will
assume it was forgotten.

Cancellation does change what a buyer would find — the last unit of a listing can
go from out of stock back to in stock — so it must call
`ListingsService.recomputeAvailableStock` (never write `available_stock` itself;
that column has one documented writer) and then `SearchIndexService`.

**This makes fulfilment the fifth reindex site**, after listings, catalogue-admin,
org-governance and checkout. CLAUDE.md and `SYSTEM-DESIGN.md` §7.2 both list them
and both must be updated. The drift test in `search.e2e` compares the table to
its source view and is what keeps that list verifiable rather than a claim; it
covers the new site for free.

---

## 7. The fourth tenant-scope escape

`common/tenant-scope.ts` documents three call sites and says to stop and ask
before adding a fourth. Asking:

A buyer cancelling their own order writes to `orders`, `order_items`,
`inventory_items` and `order_events` — all tenant-owned — and the buyer is not a
tenant. Same shape as checkout, one seller instead of several.

| Option | Verdict |
|---|---|
| Run buyer cancellation as platform admin | No. Hands a buyer's transaction unrestricted read of every tenant for its duration, to solve a narrow write problem — the argument ADR 0017 already rejected |
| A gated buyer `UPDATE` policy on `orders` | Expressible for `orders` alone (`USING` buyer + status in the cancellable set, `WITH CHECK` status = `CANCELLED`). Not expressible for `inventory_items`, and a buyer-writable inventory policy is not a thing this codebase should own |
| Make cancellation a request the seller actions | Rejected on product grounds: "cancel" that means "ask" is a support ticket wearing a button |
| `asTenantScope(order.tenant_id)` for exactly those writes | **Yes** |

The safety rule holds unchanged and is the reason this is allowed: the tenant is
`orders.tenant_id`, **read from the database inside the transaction**, after the
buyer's own `own_orders` policy has already proved the order is theirs. The buyer
chose an order, never a tenant; no caller-supplied value reaches the call.
Transaction-local, restored in a `finally`, wrapping the smallest possible amount
of work.

This is genuinely not "tenant-scoped work being done from the wrong place" — the
prior three escapes' failure mode. It is a non-tenant legitimately initiating a
tenant-scoped write, which is what the helper exists for. **ADR 0019** records
it, and `tenant-scope.ts` grows a fourth entry in its list.

Seller-driven cancellation needs none of this: the interceptor has already
resolved the tenant.

---

## 8. API surface

Seller, all under `@RequireCapability('order:write')` except the existing reads:

```
POST   /seller/orders/:id/accept
POST   /seller/orders/:id/reject            { reason }
POST   /seller/orders/:id/shipments         { items: [{ orderItemId, quantity }],
                                              carrierName?, trackingNumber? }
POST   /seller/orders/:id/shipments/:sid/delivered
POST   /seller/orders/:id/cancel            { items?: [...], reason }
GET    /seller/orders/:id/packing-slip      (JSON; the print view is a web route)
```

Buyer:

```
POST   /orders/:id/cancel                   { reason? }     — whole order only
GET    /orders/:id                          — gains `shipments` and `timeline`
GET    /orders/:id/invoice                  (JSON)
```

Notes that are decisions:

- **Buyer cancellation is whole-order only.** Line-level cancellation is a seller
  capability (out of stock on one line); a buyer wanting to drop one item is
  asking for a return, which is Phase 8.
- **Shipment creation is idempotent on a client-supplied key**, the Phase 4
  pattern: a unique constraint, insert-then-read-the-row-count, never a prior
  `SELECT`. A retried dispatch that ships the parcel twice is a real failure with
  real money attached.
- Rejections carry a reason and it is required. A rejection rate without reasons
  tells Phase 7 nothing.
- `packages/api-client` schemas and `apps/api/test/contract.e2e.test.ts` extend
  to cover every new endpoint. The contract test is uncommitted work from the
  storefront pass; this phase is its first real exercise.

---

## 9. Web

**Buyer — `apps/web/app/orders/[id]/page.tsx`** gains a vertical timeline from
`order_events` and a per-shipment block (carrier, tracking number, its lines).
Follows `DESIGN-DIRECTION.md`: colour is informational only, so a timeline step
is coloured when its state means something (`REJECTED`, `CANCELLED`) and neutral
otherwise. No progress-bar theatre for states that have not happened.

**Seller — `apps/web/app/seller/orders/`**, new. List with status filter, detail
with the verbs. Functional skeleton, not the designed console: the design
direction defers the console until these states settle, and they settle here.

**Print views — `/seller/orders/[id]/packing-slip` and `/orders/[id]/invoice`**,
server-rendered with a print stylesheet. No PDF dependency.

**This is where the front-end test convention gets chosen**, since `apps/web`
still has `"test": "echo 'no web unit tests in phase 0'"` and
`DESIGN-DIRECTION.md` §11 flags that whatever the first screen does becomes the
pattern. The proposal: Vitest + Testing Library on the pure view helpers and on
server-action input validation, no browser runner, no snapshot tests. E2E stays
in `apps/api`, against the API, where it already is.

---

## 10. Testing

| Concern | Where | Shape |
|---|---|---|
| Transition table | `packages/shared/src/order-state.test.ts` | pure, 100 % threshold |
| Allocation exactness | same file | the rounding case from §5.3, asserted to the unit |
| RLS on 3 new tables | `packages/db/src/fulfilment-rls.test.ts` | mutation-verified gates |
| Append-only `order_events` | same | 42501 on UPDATE and DELETE |
| Over-shipment trigger | `packages/db/src/fulfilment-constraints.test.ts` | inserts succeed, **commit** fails |
| Concurrent dispatch | `apps/api/test/fulfilment.e2e.test.ts` | two dispatches of the last unit → one wins, one 409 |
| Partial settlement | same | the acceptance criterion, asserted on ledger balances |
| Seller isolation on a shared order | same | the second acceptance criterion |
| Reindex on cancellation | `search.e2e` drift test | already exists; new site covered by it |

Test emails and slugs namespaced `fulfilment-`. No seeded user or organisation is
mutated. Every DB suite starts its own Testcontainer; `DATABASE_URL` stays unset.

---

## 11. Documentation to update

- **ADR 0019** — buyer cancellation as the fourth tenant-scope escape (§7)
- **ADR 0020** — dispatch-release: why capture stopped paying sellers, the
  rounding counterexample, and why `allocate()` landed here rather than in
  Phase 8 as Phase 4 predicted
- `docs/SYSTEM-DESIGN.md` — the order lifecycle diagram gains the five states;
  §7.2's reindex list gains a fifth site; the ERD gains three tables
- `CLAUDE.md` — the reindex-hook sentence, the tenant-scope-escape count, the
  100 %-coverage file list, the seed line if fixtures change
- `docs/DESIGN-DIRECTION.md` — §11's "no front-end test convention" open decision
  is closed by §9

---

## 12. Out of scope, deliberately

| Not here | Where |
|---|---|
| Gateway refunds, returns, RMA | Phase 8 |
| Carrier integrations, tracking events, delivery slots, COD collection | Phase 6 |
| Shipping labels | Nowhere until a carrier exists to scan them |
| Multi-warehouse allocation | Phase 6 — a shipment references order items, not warehouses, and gains that column when warehouses gain a strategy |
| Seller rating on rejection rate | Phase 7 — `order_events` records what it will need |
| The designed seller console | after Phase 5, against `DESIGN-DIRECTION.md` |
