# Phase 4 — Cart, Checkout & Ledger Implementation Plan

**Spec:** `docs/PRD-marketplace-migration.md` §9.1 (Cart & checkout), §10.1
(Payments — port + ledger), §8.1/§8.4 (data model, Money), §11 Phase 4, §13
(idempotency, optimistic locking, 100 % on ledger).

**Acceptance (PRD §11):** ledger invariant tests at 100 %; a cart with 3 sellers
produces 3 orders; **price tampering rejected**; **the webhook is the only writer
of payment status**.

**Demo:** cart spanning 3 sellers → one payment → 3 orders → balanced ledger.

---

## Global Constraints

Unchanged, and repeated because they are what breaks silently:

- **Never import `db` or `pool`.** Public routes open their own
  `withTenant({ tenantId: null, ... })`, as the catalogue already does.
- **A second permissive policy on a tenant-owned table widens every
  tenant-scoped read.** Gate any new one on
  `NULLIF(current_setting('app.tenant_id', true), '') IS NULL`. Phase 4 adds the
  **third** instance — see F-3.
- **New tenant-owned tables need `ENABLE` + `FORCE` + policies in a hand-written
  migration** created with `drizzle-kit generate --custom`.
- **Never mutate seeded users or organisations in a test.** Register your own.
- **Namespace test emails and slugs per file** (`cart-`, `checkout-`, `ledger-`,
  `orders-`, `webhook-`).
- Money is integer minor units, `bigint` + `char(3)`. No floats anywhere.
- Four gates must pass: `pnpm lint && pnpm type-check && pnpm test && pnpm build`.

---

## Audit: what cross-checking `docs/SYSTEM-DESIGN.md` changed

Seven findings. Four of them changed this plan; three change the document, and
Task 10 makes those edits.

### F-1 — `allocate()` is **not** what Phase 4 needs. *(document is wrong)*

`SYSTEM-DESIGN.md` §11 lists "split one payment across sellers without losing a
minor unit → `allocate()`" as a Phase 4 seam. Checked against the actual
arithmetic: each seller's subtotal is computed independently from their own
`order_items`, and commission is a percentage **of that subtotal**. Seller
payable = subtotal − commission, so the parts sum exactly by construction —
there is no remainder to distribute and nothing for `allocate()` to do.

`allocate()` earns its place at the first amount that is computed **once at cart
level and then split**: a cart-wide promotion (Phase 9) or a partial refund
against a multi-seller order (Phase 8). Phase 4 needs `multiply`, which already
rounds half away from zero and is already covered.

**Change:** correct §11 of the system design; do not force `allocate()` into the
commission path to make an old sentence true.

### F-2 — Checkout is a **fourth** search-reindex site. *(plan changed)*

`SYSTEM-DESIGN.md` §7.2 names three reindex sites: listings, catalogue-admin,
org-governance. Placing an order reduces available stock, and
`search_documents` carries `in_stock`, `min_price_amount` and `seller_count`
derived from **eligible** offers — where eligibility excludes out-of-stock. So
an order that takes the last unit changes what a buyer would find, and
**a write that changes what a buyer would FIND must reindex**.

Worse: `listings.available_stock` already has exactly one documented writer
(`listings.service.ts:233`, commented `THE ONLY WRITER`). Checkout must go
through that writer rather than issuing its own `UPDATE`, or a denormalised
column acquires a second writer and the two drift under concurrency.

**Change:** Task 7 calls the existing recompute writer and then
`SearchIndexService.reindexForListing`, and the `search.e2e` drift test gains a
checkout case. Without this finding the phase would have shipped a silent
staleness bug of exactly the kind the drift test exists to catch.

### F-3 — Orders need the gated-policy pattern a **third** time. *(plan changed)*

A seller must see only their own orders. A buyer must see **their** orders
across every seller — and a buyer is not a tenant, so their requests carry no
`app.tenant_id`.

That is precisely the `own_membership` (0006) / `public_active_offers` (0008)
shape: a second permissive policy on a tenant-owned table, gated on **no tenant
selected**, keyed this time on `app.user_id` — the GUC that exists because of
ADR 0011 and has so far only been read by the membership bootstrap.

**Change:** migration `0012` adds `own_orders` with the gate, and
`orders-rls.test.ts` mutation-verifies it by deleting the gate. The system
design's §3.3 table gains a row and stops reading as a cautionary tale about the
past.

### F-4 — The ledger **cannot** be tenant-owned. *(plan changed)*

One `transactions` row posts entries against two sellers' payable accounts and
the platform's revenue account. Under RLS with a tenant GUC set, that write is
impossible: whichever tenant is selected, the other sellers' rows fail
`WITH CHECK`. Making it work would need a **third** tenant-scope escape, and
§3.5 of the system design says explicitly to stop and ask first.

Asking gives the right answer: **the ledger is the platform's books, not any
seller's data.** So `ledger_accounts`, `ledger_entries`, `transactions`,
`payment_intents` and `payment_events` are **platform-owned**, and a seller
reads their own payable balance through an `owner_org_id` filter in the service —
the `saved_searches` pattern, where the filter is the *only* boundary and is
therefore tested as one.

**Change:** no third escape hatch. `withoutTenantScope` stays at exactly one
caller. §4's ownership table gains a "platform-owned, org-scoped in the service"
row.

### F-5 — Guest carts introduce the first **public write** routes. *(plan changed)*

`route-coverage.e2e` allowlists `@Public()` routes; today all 13 are reads (plus
auth). `POST /cart/items` for a guest is a public **mutation**, which is a
different risk class, and an allowlist that does not distinguish them silently
weakens the test that guards deny-by-default.

**Change:** Task 5 splits the allowlist into `PUBLIC_READS` and
`PUBLIC_WRITES`, and the public-write list carries a one-line justification per
entry that the test asserts is non-empty.

### F-6 — Phase 4 needs **no new capability**. *(confirmed, no change)*

`order:read` and `order:write` already exist in `capabilities.ts`, already
assigned: `OWNER`/`MANAGER` both, `STAFF` both, `FINANCE` `order:read` plus the
payout pair. Do not add `checkout:*` or `cart:*` — buyers are not tenants and
capabilities are a seller-side concept.

### F-7 — Do **not** add `order:write` to `WITHDRAWN_WHILE_SUSPENDED`. *(guard rail)*

PRD §6.6 requires a suspended seller to keep fulfilling open orders. The
withdrawal set is `product:write`, `settings:write`, `payout:write`,
`member:write` and must stay that way. Task 9 adds an explicit regression test,
because this is the sort of thing a later "tighten suspension" commit breaks
while looking correct.

---

## Phase 4 scoping decisions

### D-A. Entries carry a **signed** amount; debit is positive

`ledger_entries.amount` is a signed `bigint` in minor units. Debit is positive,
credit negative. The balance invariant is then literally `SUM(amount) = 0` per
transaction.

Rejected: a `direction` enum with positive amounts, which is more readable in a
row viewer but makes every balance check
`SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END)`. Every place
that forgets the `CASE` produces a wrong number that still looks like a number,
and there will be many such places by Phase 10. Readability is bought back with
a `ledger_entries_readable` view that renders `DR`/`CR` columns for humans.

`CHECK (amount <> 0)` — a zero entry is always a bug, never a rounding result.

### D-B. The balance is enforced by a **deferred constraint trigger**, not only by code

`LedgerService.post()` validates before inserting. That is not enough: it is one
function, and nothing stops a future service from calling `tx.insert(ledgerEntries)`
directly. A `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` re-checks
`SUM(amount) = 0` per `transaction_id` **at commit**, so an unbalanced write
fails no matter who wrote it.

Phase 3 rejected triggers for the search index — that rejection stands and this
is not in tension with it. The distinction is **assertion versus side effect**:
the search trigger would have *written data* invisibly from the call site,
whereas this one writes nothing and can only refuse. An invariant that cannot be
bypassed is the entire reason a ledger is trusted, and "we always call the
helper" is a claim no test can make about code not yet written.

The trigger must be `DEFERRABLE INITIALLY DEFERRED`, because entries are
inserted one statement at a time and are legitimately unbalanced between them.

### D-C. Append-only, and the chart of accounts Phase 4 actually needs

`ledger_entries` is never updated and never deleted; a mistake is corrected by
posting a reversing transaction. There is no `UPDATE`/`DELETE` grant on the
table for `nexmarket_app`, so this is enforced by privilege rather than by
discipline.

Accounts are `(kind, owner_org_id, currency)`, unique together:

| kind | owner | meaning |
|---|---|---|
| `BUYER_RECEIVABLE` | none | owed by buyers — debited when an order is placed |
| `PLATFORM_CLEARING` | none | money in transit between buyer and sellers |
| `SELLER_PAYABLE` | org | owed to one seller |
| `PLATFORM_REVENUE_COMMISSION` | none | the platform's take |
| `COD_RECEIVABLE` | none | delivered but not yet collected — **created in Phase 4, posted to in Phase 6** |

`COD_RECEIVABLE` exists now because the COD adapter must debit *something* at
placement, and a chart of accounts that grows a new kind per phase makes every
historical balance query phase-dependent.

### D-D. `payment_intents` is the grouping entity; there is no `order_groups`

One checkout produces one `payment_intents` row and N `orders` rows, one per
seller, each with its own `order_number`. PRD §8.1 lists `payment_intents` and
does **not** list a group table, and a second grouping entity alongside it would
have no field the intent lacks.

### D-E. The client never sends a price; `expectedTotal` is a **comparison**

`POST /checkout/confirm` takes `{ cartId, addressId, paymentMethod,
idempotencyKey, expectedTotal: Money }`. The server recomputes the whole quote
from `listings` and compares. Mismatch is **409 `PriceChanged`** carrying the
new quote — not 400, because the common cause is a seller repricing mid-checkout
and the client's correct response is to re-render, not to retry.

Tampering is therefore rejected by construction: there is no code path where a
client-supplied number becomes an order total. Sending a lower `expectedTotal`
gets a 409 and no order; sending none gets a 400 from the DTO. The acceptance
test asserts **no order and no ledger entry** exist after a tampered confirm,
not merely that the response was an error.

### D-F. The webhook is the only writer of `payment_intents.status`

`POST /checkout/confirm` creates the intent as `REQUIRES_PAYMENT` and never
advances it, even for the mock adapter that could succeed synchronously.
`PaymentWebhookService.apply()` is the sole caller of the status transition.

Idempotency is a **unique constraint, not a lookup**:
`payment_events(provider, provider_event_id)` is unique, the handler inserts
first, and a `23505` means "already applied" → 200, no re-post. A gateway that
retries three times produces one set of ledger entries, and the test delivers
the same event twice and counts them.

### D-G. Reservation is a conditional `UPDATE`, not a read-then-write

```sql
UPDATE inventory_items
   SET reserved = reserved + $qty
 WHERE listing_id = $listing AND (on_hand - reserved) >= $qty
RETURNING id;
```

Zero rows returned means insufficient stock → 409. No lost update is possible,
because the check and the write are one statement. This is PRD §13's "optimistic
locking on inventory" in its cheapest correct form; a `SELECT ... FOR UPDATE`
would serialise every checkout on a popular listing for the whole transaction.

Then, per F-2: recompute `listings.available_stock` through its existing single
writer, and reindex the product.

### D-H. A guest cart is a hashed token in an `httpOnly` cookie

`carts(id, user_id NULL, token_hash NULL, status)` with
`CHECK (user_id IS NOT NULL OR token_hash IS NOT NULL)`. The guest token is 256
bits of CSPRNG output, stored as SHA-256 — the same treatment `sessions` gives
refresh tokens (ADR 0012), for the same reason: a database dump must not be a
set of live credentials.

`POST /cart/merge` runs on login, **sums** quantities per listing (PRD: "not
overwritten"), and marks the guest cart `MERGED` rather than deleting it, so a
double-submitted merge is a no-op instead of a resurrection.

### D-I. Shipping is a port; tax is a pure function

Shipping gets a `ShippingQuoteProvider` port with a `FlatRateAdapter` now,
because Phase 6 explicitly swaps in zone and rate-card logic and the port is the
seam that makes that one file.

Tax does **not** get a port. PRD §10 names five ports and tax is not among them;
tax rules are data — a rate per country — and a pure
`taxFor(subtotal, countryCode)` in `@nexmarket/shared` is testable, has no
adapter to swap, and does not pretend a Phase 12 integration is planned.

### D-J. Commission is per-category with a platform default

Resolving PRD open question Q3 with its stated default. `categories.commission_bps`
(nullable) overrides `PLATFORM_DEFAULT_COMMISSION_BPS`; `organisations.commission_bps`
(nullable) overrides both, for the per-seller deals PRD §9.3 asks for. Basis
points, not percent, because 2.5 % is not representable as an integer percentage
and a float in a money path is the bug this project exists to make
unrepresentable.

Commission is **snapshotted onto `order_items`** at placement. A rate change next
month must not silently restate last month's payables.

### D-K. Three payment adapters, and what "Stripe" honestly means here

- **`MockAdapter`** — succeeds or fails on cue via the intent's client secret,
  emits a webhook the test delivers itself. Fully tested.
- **`CodAdapter`** — no gateway; the intent goes to `COD_PENDING` and the order
  is placed. Money moves at delivery, which is Phase 6, so Phase 4 posts to
  `COD_RECEIVABLE` and stops there. Fully tested.
- **`StripeAdapter`** — implements the port against Stripe's REST API with
  `fetch` (two endpoints; the SDK would be a dependency and an install-script
  allowlist entry for no gain). **Webhook signature verification is real HMAC
  and is fully unit-tested** with constructed signatures, including the
  timestamp-tolerance and the wrong-secret cases. `createIntent` is tested
  against a local stub server; a live-key integration test exists and **skips**
  without `STRIPE_SECRET_KEY`.

All three must pass one shared **port contract suite**, which is what makes the
port a real seam rather than an interface with one implementation.

---

## File Structure

```
packages/shared/src/
  ledger.ts               chart of accounts, Entry, balance rules — pure, 100 %
  ledger.test.ts
  pricing.ts              commissionFor · taxFor · lineTotal — pure, 100 %
  pricing.test.ts

packages/db/src/schema/
  carts.ts                carts · cart_items · addresses         platform-owned
  orders.ts               orders · order_items                   TENANT-owned
  payments.ts             payment_intents · payment_events · transactions
  ledger.ts               ledger_accounts · ledger_entries       platform-owned
packages/db/migrations/
  0011_commerce_tables.sql        generated
  0012_commerce_rls.sql           hand-written: FORCE, own_orders gate, grants,
                                  the balance constraint trigger, no UPDATE/DELETE
                                  grant on ledger_entries
packages/db/src/seed/
  addresses.ts · carts.ts         idempotent, one demo cart spanning 3 sellers

apps/api/src/modules/
  cart/        cart.service · cart.controller · guest-token.ts · dto · module
  addresses/   addresses.service · controller · dto · module
  checkout/    quote.service        pricing pipeline, age gate
               checkout.service     reserve → split → intent → post
               checkout.controller · dto · module
  payments/    payment-provider.port.ts     PAYMENT_PROVIDER symbol
               mock.adapter.ts · cod.adapter.ts · stripe.adapter.ts
               payment-webhook.service.ts   THE ONLY writer of intent status
               webhook.controller.ts · payments.module.ts
  ledger/      ledger.service.ts    the only writer of ledger_entries
               ledger.module.ts
  orders/      orders.service · orders.controller (buyer)
               seller-orders.controller · module
  shipping/    shipping-quote.port.ts · flat-rate.adapter.ts · module

apps/api/test/
  cart.e2e.test.ts · checkout.e2e.test.ts · ledger.e2e.test.ts
  payments.e2e.test.ts · orders.e2e.test.ts
packages/db/src/orders-rls.test.ts · ledger-constraints.test.ts
```

---

## Task 1: Ledger and pricing primitives (pure, 100 %)

**Files:** create `packages/shared/src/ledger.ts`, `ledger.test.ts`,
`pricing.ts`, `pricing.test.ts`; modify `packages/shared/src/index.ts`,
`vitest.config.ts` (coverage thresholds).

**Produces:** `AccountKind`, `type Entry = { kind, ownerOrgId, amount: Money }`,
`assertBalanced(entries): void`, `captureEntries(input): Entry[]`,
`commissionFor(subtotal, bps): Money`, `taxFor(subtotal, countryCode): Money`,
`PLATFORM_DEFAULT_COMMISSION_BPS`.

- [ ] **Step 1: Write the failing tests.** Balanced set passes; one-sided set
  throws naming the imbalance and its amount; mixed currencies throw; a
  single-entry transaction throws; a zero amount throws.
  `captureEntries` for the PRD §10.1 worked example — ৳1000, two sellers, 10 % —
  must produce exactly the eight entries in the PRD, and must sum to zero.
  Property test: for 500 random 1–5 seller splits with random bps, the entries
  balance and `SUM(seller payable) + SUM(commission) = buyer receivable`.
- [ ] **Step 2: Run — expect failures for undefined exports.**
- [ ] **Step 3: Implement.** `commissionFor` is `multiply(subtotal, bps / 10_000)`
  — reuse it, do not re-derive rounding.
- [ ] **Step 4: Run tests; then run coverage and confirm 100 % on both files.**
- [ ] **Step 5:** Add `ledger.ts` and `pricing.ts` to the 100 % threshold list
  alongside `money.ts`, `capabilities.ts`, `buy-box.ts`. Re-run.

## Task 2: Schema and migrations

**Files:** create the four schema modules, `0011_commerce_tables.sql`,
`0012_commerce_rls.sql`; modify `schema/index.ts`, `categories.ts`
(`commissionBps`), `organisations.ts` (`commissionBps`).

- [ ] **Step 1:** Write `packages/db/src/orders-rls.test.ts` first — it fails
  until 0012 exists. Assert: a seller sees only their own orders; **with no
  tenant selected and `app.user_id` set, a buyer sees their orders across two
  sellers**; with neither set, zero rows; `relforcerowsecurity` is true for
  `orders` and `order_items`.
- [ ] **Step 2:** Write `ledger-constraints.test.ts`: an unbalanced pair of
  inserts raises at **COMMIT**, not at insert; a balanced pair commits; `UPDATE`
  and `DELETE` on `ledger_entries` are refused for `nexmarket_app`.
- [ ] **Step 3: Run both — expect "relation does not exist".**
- [ ] **Step 4:** Author the schema modules. `orders` and `order_items` carry
  `tenant_id`; everything else in Phase 4 does not (F-4).
- [ ] **Step 5:** `pnpm --filter @nexmarket/db exec drizzle-kit generate --custom --name=commerce_tables`,
  then again `--name=commerce_rls`. **Never hand-drop a `.sql` file** — an
  unjournalled migration looks applied and never runs.
- [ ] **Step 6:** Write 0012 by copying the shape of `0008_catalogue_rls.sql`:
  `ENABLE` + `FORCE` on `orders`/`order_items`, the tenant policy with the
  `NULLIF(...)::uuid` wrapper, then the gated buyer policy:

```sql
CREATE POLICY own_orders ON orders FOR SELECT USING (
  NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  AND buyer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
);
```

  No `WITH CHECK` — a buyer must not be able to insert an order attributed to
  themselves outside checkout. Then the deferred balance trigger, and grants
  that give `nexmarket_app` `SELECT, INSERT` on `ledger_entries` and no more.
- [ ] **Step 7: Run both test files — expect pass. Then delete the
  `IS NULL` gate from `own_orders`, re-run, and confirm the seller-isolation
  test fails.** Restore it. An ungated policy is the bug from 0006 and 0008; a
  test that passes either way has not tested it.
- [ ] **Step 8:** `pnpm db:push && pnpm seed && pnpm seed` against the dev
  database — twice, to prove idempotence.

## Task 3: `LedgerService`

**Files:** create `apps/api/src/modules/ledger/ledger.service.ts`,
`ledger.module.ts`; test in `apps/api/test/ledger.e2e.test.ts`.

**Produces:** `post(tx, { kind, reference, entries }): Promise<Transaction>`,
`balanceFor(tx, kind, ownerOrgId?): Promise<Money>`,
`entriesForTransaction(tx, id)`.

- [ ] **Step 1:** Failing tests — `post` creates one `transactions` row and N
  entries; an unbalanced call throws **before** touching the database; accounts
  are created on first use and reused thereafter (assert one row after two
  posts); `balanceFor` sums correctly; **two concurrent posts to the same
  account both land and the account balance is exact** (PRD §10.1's fourth
  invariant).
- [ ] **Step 2: Run — expect failure.**
- [ ] **Step 3:** Implement. `post` calls `assertBalanced` from Task 1 first, so
  the pure rule and the persisted rule are the same rule. Account creation is
  `INSERT ... ON CONFLICT (kind, owner_org_id, currency) DO UPDATE SET kind =
  EXCLUDED.kind RETURNING id` — a plain `DO NOTHING` returns no row on conflict
  and the code then inserts an entry with a null account id.
- [ ] **Step 4: Run; confirm the concurrency test passes ten times in a row.**
- [ ] **Step 5:** `@Global()` module, like `SearchModule` — checkout, the
  webhook and Phase 5 refunds all need it.

## Task 4: Address book

**Files:** create `apps/api/src/modules/addresses/*`; test in
`apps/api/test/checkout.e2e.test.ts`.

- [ ] **Step 1:** Failing tests — CRUD scoped to the caller; **user A cannot
  read, update or delete user B's address** (404, not 403 — existence is
  information); setting a default unsets the previous one in the same
  transaction; cursor pagination with the shared helper.
- [ ] **Step 2: Run — expect 404 route not found.**
- [ ] **Step 3:** Implement. The `user_id` filter appears in **every** method,
  not in a helper — same rule as `saved_searches`, for the same reason.
- [ ] **Step 4: Run.** **Step 5:** Commit.

## Task 5: Cart, guest and member

**Files:** create `apps/api/src/modules/cart/*`; modify
`apps/api/test/route-coverage.e2e.test.ts` (F-5).

- [ ] **Step 1:** Failing tests in `cart.e2e.test.ts` — add, update quantity,
  remove, read; **the cart response groups lines by seller** with a per-seller
  subtotal; a guest gets a cookie and their cart survives a second request; a
  cart line for an archived or paused listing is returned flagged
  `unavailable: true` rather than silently dropped; **merge sums quantities**;
  a second merge of the same guest cart is a no-op; the cart stores **no
  price column** — assert by reflecting over the table's columns.
- [ ] **Step 2:** Extend `route-coverage.e2e` per F-5: split the allowlist into
  `PUBLIC_READS` and `PUBLIC_WRITES`, require a non-empty justification string
  for every public write, and fail on any public route in neither list.
- [ ] **Step 3: Run both — expect failure.**
- [ ] **Step 4:** Implement. `guest-token.ts` mints 32 random bytes, sets an
  `httpOnly` cookie, stores SHA-256. Reuse the hashing helper from `sessions`
  rather than writing a second one.
- [ ] **Step 5: Run; confirm route-coverage still passes and now lists the four
  public cart writes with justifications.**

## Task 6: The quote pipeline

**Files:** create `apps/api/src/modules/checkout/quote.service.ts`,
`apps/api/src/modules/shipping/*`.

**Produces:** `quote(tx, { cart, address }): Promise<Quote>` where `Quote` has
`groups: SellerGroup[]`, `total: Money`, `requiresAgeCheck: boolean`.

- [ ] **Step 1:** Failing tests — a 3-seller cart produces 3 groups, each with
  subtotal, shipping, tax and commission; the total is the sum of the groups and
  **is recomputed, never accumulated from the request**; a `RESTRICTED` category
  anywhere in the cart sets `requiresAgeCheck`; an out-of-stock line fails the
  quote with the listing named; a listing whose seller is `SUSPENDED` fails the
  quote — it is not a purchasable offer even though the seller may still fulfil
  existing orders (F-7 is about capabilities, not about new sales).
- [ ] **Step 2: Run — expect failure.**
- [ ] **Step 3:** Implement. Shipping through the port; tax and commission
  through Task 1's pure functions. Every price is read from `listings` inside
  the request transaction.
- [ ] **Step 4: Run.** **Step 5:** Commit.

## Task 7: Checkout confirm — reserve, split, post

**Files:** create `apps/api/src/modules/checkout/checkout.service.ts`,
`checkout.controller.ts`, `dto.ts`, `checkout.module.ts`; modify
`apps/api/test/search.e2e.test.ts` (F-2).

- [ ] **Step 1:** Failing tests in `checkout.e2e.test.ts`:
  - a cart with **3 sellers produces exactly 3 orders**, each with its own
    `order_number`, all sharing one `payment_intent_id` — the PRD acceptance
    criterion;
  - **price tampering**: confirm with `expectedTotal` one minor unit low → 409,
    and **zero orders and zero ledger entries exist afterwards**;
  - the age gate: `RESTRICTED` in cart without `dateOfBirth` → 400; under 18 →
    403; over 18 → order placed with `age_verified_at` set and **no date of
    birth stored anywhere** (assert the column does not exist);
  - stock: two concurrent confirms for the last unit → exactly one 201 and one
    409, and `reserved` never exceeds `on_hand`;
  - the intent is left at `REQUIRES_PAYMENT` — **confirm never advances it**;
  - the ledger balances: `SUM(amount) = 0` over the transaction, and
    seller payable + commission = buyer receivable.
- [ ] **Step 2:** Add the F-2 case to the search drift test: place an order that
  takes the last unit of a listing, then assert `search_documents` matches
  `search_document_source` — which it will not until Step 4.
- [ ] **Step 3: Run — expect failure, including a red drift test.**
- [ ] **Step 4:** Implement in this order inside one transaction: quote →
  reserve (D-G) → create intent → create orders and items with **snapshotted**
  prices, commission and product name → post the ledger → recompute
  `available_stock` **through `ListingsService`'s existing single writer** →
  `SearchIndexService.reindexForListing`.
- [ ] **Step 5: Run both files; the drift test must now pass.**
- [ ] **Step 6:** Idempotency — a repeated `idempotencyKey` returns the original
  orders rather than creating a second set. Test it.

## Task 8: The payment port, three adapters, and the webhook

**Files:** create `apps/api/src/modules/payments/*`; test in
`apps/api/test/payments.e2e.test.ts`.

- [ ] **Step 1:** Write the **port contract suite** as a function taking an
  adapter, and run it against all three: `createIntent` returns a reference;
  `verifyWebhook` rejects a tampered body, a wrong secret and a stale timestamp,
  and accepts a well-formed one.
- [ ] **Step 2:** Failing webhook tests — a `payment_succeeded` event moves the
  intent to `SUCCEEDED` and posts the capture transaction; **the same event
  delivered twice produces one set of ledger entries** (count them); an event
  for an unknown intent is 404 and posts nothing; an event with a bad signature
  is 400 and posts nothing; a `payment_failed` event moves the intent to
  `FAILED` and **releases the inventory reservation**.
- [ ] **Step 3: Run — expect failure.**
- [ ] **Step 4:** Implement. The Stripe HMAC is
  `HMAC-SHA256(timestamp + "." + rawBody, secret)` compared with
  `crypto.timingSafeEqual`. The webhook route needs the **raw body** — register
  a content-type parser in `configure-app.ts`, the one place `main.ts` and the
  e2e suite share, or the signature verifies in production and fails in tests.
- [ ] **Step 5: Run.** **Step 6:** Assert the single-writer property: a test
  that greps the compiled module graph for writes to `payment_intents.status`
  outside `payment-webhook.service.ts` fails if a second writer appears.

## Task 9: Order reads, buyer and seller

**Files:** create `apps/api/src/modules/orders/*`.

- [ ] **Step 1:** Failing tests in `orders.e2e.test.ts` — a buyer lists **their
  orders across all three sellers** in one call with no tenant header; a seller
  with a tenant header sees only their own; seller A requesting seller B's order
  by id gets 404; a `SUSPENDED` seller **can still read and act on open orders**
  (F-7 regression); cursor pagination; oversized `limit` rejected, not clamped.
- [ ] **Step 2: Run — expect failure.**
- [ ] **Step 3:** Implement. The buyer controller sets no tenant and relies on
  `own_orders`; the seller controller is tenant-scoped and relies on the base
  policy. **Neither adds a `WHERE tenant_id` in the service** — that would mask
  a policy regression behind an application filter.
- [ ] **Step 4: Run.** **Step 5:** Commit.

## Task 10: Acceptance evidence, gates, and the document corrections

- [ ] **Step 1:** Write the demo path as one e2e test: 3 sellers → cart → quote
  → confirm → webhook → 3 orders, balanced ledger. Assert every PRD §11
  acceptance criterion in it explicitly, each with a comment naming the criterion.
- [ ] **Step 2:** Seed a demo cart and one completed order so `pnpm seed` leaves
  a demoable state. Run `pnpm seed` twice.
- [ ] **Step 3:** Run all four gates. Then `pnpm --filter @nexmarket/api perf` —
  reindexing on checkout must not regress search latency.
- [ ] **Step 4:** ADRs — `0016-the-ledger-and-its-constraint-trigger.md`
  (D-A, D-B, D-C, and why F-4 makes it platform-owned),
  `0017-orders-and-the-buyer-policy.md` (F-3, D-D, D-E),
  `0018-payment-port-and-webhook-idempotency.md` (D-F, D-K). Index them in
  `docs/architecture/README.md`.
- [ ] **Step 5: Apply the audit findings to `docs/SYSTEM-DESIGN.md`:**
  - §3.3 — add the `orders` / `own_orders` row to the OR-trap table (F-3).
  - §3.5 — state that Phase 4 considered and **rejected** a third tenant-scope
    escape, and why (F-4).
  - §4 — add `orders`/`order_items` to tenant-owned; add a
    "platform-owned, org-scoped in the service" row for the ledger tables (F-4).
  - §7.2 — add checkout to the reindex sites diagram and prose (F-2).
  - §11 — **correct the `allocate()` claim** (F-1); move it to Phases 8–9.
  - §1, §8, §10 — refresh route count, module map and the invariant table.
  - Re-run the mermaid validation over the file; all diagrams must parse.
- [ ] **Step 6:** Update `README.md` (status, test count, acceptance table) and
  `CLAUDE.md` (Phase 4 rules: the ledger is append-only; the webhook is the only
  writer of payment status; checkout reindexes).

---

## Known gaps, to be stated rather than hidden

- **Shipping is a flat rate.** Zones, rate cards and dimensional weight are
  Phase 6; the port is the seam and the adapter is one file.
- **COD posts to `COD_RECEIVABLE` and stops.** Collection and reconciliation are
  Phase 6, which is where the money actually arrives.
- **No promotions, no coupons, no loyalty.** Phase 9. This is why `allocate()`
  is not yet used (F-1).
- **Refunds are not implemented.** Phase 8. The ledger is append-only and
  reversal-based specifically so refunds need no schema change.
- **The Stripe adapter's `createIntent` is not exercised against live Stripe**
  in CI — no account, no key. Its signature verification is real and fully
  tested; the live path skips without `STRIPE_SECRET_KEY`, and that skip is
  visible in the run rather than silent.
- **Tax is a single rate per country.** Jurisdictions, exemptions and
  registrations are out of scope for every phase in this PRD.
