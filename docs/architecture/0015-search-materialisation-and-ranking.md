# ADR 0015 - Search: one materialisation, one predicate, and what the numbers cost

**Status:** accepted
**Date:** 2026-09-04
**Phase:** 3
**Implements:** PRD 9.1 (Discovery), 10.2 (Search), 11 Phase 3.

## Context

Phase 3 has three blocking criteria: **p95 < 300 ms on 50k products**, **typo
tolerance verified**, and **facet counts that match filtered results exactly**.
The third is the one that shapes the design; the first is the one that cost the
most.

## Decision 1: a materialised table whose definition lives in a view

`search_documents` is a real table, one row per ACTIVE product. What a document
*is* lives in exactly one place - the `search_document_source` view in migration
0010 - and both the incremental reindex and the full rebuild are
`INSERT ... SELECT ... FROM search_document_source`.

Rejected: a **materialized view**, which cannot be refreshed incrementally -
`REFRESH CONCURRENTLY` rebuilds all 50k rows to reflect one price change.
Rejected: **triggers**, whose appeal is that they cannot be forgotten, but which
are invisible from the call site and fire inside RLS-scoped transactions.

An application-maintained table has exactly one failure mode: a write path that
forgets to reindex. So `search.e2e` compares the table against the view row for
row after exercising every write path. **That test is what makes the hook list
verifiable rather than a claim**, and it is why a stale document - which looks
completely normal, because the API answers and the numbers are plausible - is a
red test instead of a support ticket.

The statements themselves live in `@nexmarket/db` because the SEED builds the
index too. Three layers, one definition each: what a document is (the view), how
it is written (`packages/db/src/search-index.ts`), when (`SearchIndexService`).

### The reindex must run with NO tenant selected

`listings` is tenant-isolated. Evaluating the view with a tenant selected
computes "the cheapest offer" from that one seller's rows and writes a
confidently wrong number. `SearchIndexService` therefore clears `app.tenant_id`
for the duration of the statement, which makes `public_active_offers` the
governing policy - every seller's ACTIVE offers, which is exactly the input a
cross-tenant aggregate needs.

That is one of exactly **two** places in the codebase that move the tenant GUC
outside `withTenant`; both now live behind `common/tenant-scope.ts`, which says
so and says what to ask before adding a third.

The least obvious hook is **suspending a seller**: it withdraws every one of
their offers, so the price and seller count change on products the admin never
looked at, and nothing about `POST /admin/orgs/:id/suspend` looks like it
touches search. It has its own test.

## Decision 2: one predicate, for both the results and the counts

"Facet counts match filtered results exactly" is guaranteed only if the counts
and the results come from the same SQL predicate in the same transaction.
`buildPredicate` is that predicate. The result page applies all of it; each
facet dimension applies all of it **except its own filter**.

Excluding a dimension from its own counts is the drill-down semantic: with
"Brand: Aurora" selected, the Brand facet must still say how many results
Samsung would give, or the filter can never be changed. Applying every filter to
every facet shows zero for each unselected value - trivially "exact", and
useless. There are tests for both directions: one asserts a facet stays
drillable, the other asserts a facet that is *not* excluded does narrow.

## Decision 3: full-text **or** trigram, in one predicate - never a fallback

The tempting design is "run FTS; if it returns too little, run trigram instead".
Rejected: the two produce different result sets, so the facet counts would
describe a different query than the results, and the exactness criterion fails
on any borderline search.

The predicate is `tsv @@ websearch_to_tsquery(...) OR $q <% search_text`. Both
halves are GIN-indexed.

**`<%`, not `%`.** `%` compares the query against the WHOLE document, so
"alphonzo" against "Alphonso Mango Crate Verdant Fresh Produce Rangpur" scores
far below any usable threshold - typo tolerance silently worked only for short
documents. `<%` asks whether the query resembles a continuous *extent* of the
text, which is the question a misspelled word actually poses.

The threshold is 0.5, chosen against measured values rather than by feel:

| term | word_similarity against the fixture document |
|---|---|
| `alphonzo` | 0.67 |
| `pineaple` | 0.73 |
| `himsager` | 0.67 |
| `jackfruite` | 0.82 |
| `mango` (exact) | 1.00 |
| `zzzzqqqqxxxx` | 0.00 |

It is a **GUC**, not a function argument: there is no `set_word_similarity_limit`
despite `set_limit` existing for `%`, and reaching for the symmetrical-looking
name is a 500 on every search until a test says otherwise.

## Decision 4: what ranking costs, measured

The performance criterion was missed by 4x on the first honest measurement, and
every step of closing that gap is recorded because each one was a guess until it
was measured.

Against 50k documents, for a term appearing in every one of them:

| ranking expression | latency |
|---|---|
| `ts_rank_cd(tsv, q) + word_similarity(q, text)` | **1294 ms** |
| `ts_rank(tsv, q) + word_similarity(q, text)` | 246 ms |
| `CASE WHEN tsv @@ q THEN 1 + ts_rank(...) ELSE word_similarity(...) END` | see below |

**`ts_rank`, not `ts_rank_cd`.** Cover density walks each document's term
positions, and rank must be computed for every match before the top twenty are
known - so a broad query pays it fifty thousand times. It is also the better
ranking here on the merits: cover density rewards query terms appearing close
together, which matters in prose and barely exists in a four-word product name.
The work is done by the A/B/C/D weighting in the view.

**A `CASE`, not a sum.** Adding the two scores conflates scales that mean
different things and lets a near-miss on a common word outscore an exact hit.
`1 + ts_rank(...)` for lexical matches and `word_similarity(...)` for
fuzzy-only ones puts every exact match above every typo match by construction -
better ranking, and half the function calls per row.

Two structural changes did the rest:

- **Seven facet passes became one.** A dimension the caller has not filtered has
  nothing to exclude, so its predicate *is* the base predicate. Those dimensions
  are aggregated together from a single `MATERIALIZED` scan; only a dimension
  with an active filter costs a second pass. Same predicate, same rows, same
  counts - computed once instead of seven times.
- **Three GUC round trips became one.** `withTenant` issued three separate
  `SELECT set_config(...)` statements. They fit in one `SELECT`, and that is
  three round trips saved on **every request in the system**. It surfaced while
  chasing a search budget and is the cheapest millisecond in the codebase.

Net effect on the 50k fixture: p50 **96 ms → 37 ms**, and the worst query shape
from 1294 ms to a 120 ms median.

## What is NOT proven: the p95 number itself

The criterion is p95 < 300 ms. **This repository does not prove that**, and the
test says so rather than asserting something it cannot support.

Every query shape's median at 50k documents is 7–120 ms, and its best case is
4–108 ms. But the harness - a Docker-hosted Postgres sharing a laptop or a CI
runner with the rest of the suite - delivers multi-hundred-millisecond stalls to
queries whose best case is single-digit milliseconds. Measured on consecutive
runs of the same file:

```
run A   q=mango&inStock=true   median  15 ms   max  594 ms
run B   q=mango&inStock=true   median 527 ms   max 1143 ms
```

An 80x spread on one shape is the host, not the code. Asserting a raw p95 there
produces a test that fails on a busy machine and passes on an idle one, which is
worse than no test: it teaches people to re-run it.

So `search-perf.e2e.test.ts` **asserts on the best observed latency per query
shape** - the figure that reflects the query plan - **reports the full
distribution on every run**, and separately asserts that the GIN indexes are
used rather than scanned past, so a dropped index fails with a clear reason
instead of showing up as a slow day.

One real finding came out of the jitter and is worth keeping: a large share of
it was **connection establishment**. A pool that opens a connection mid-run
charges that request for a TCP connect and an authentication handshake. The perf
suite now warms the pool before measuring, and a deployment should size its pool
minimum rather than discover this in production.

**Outstanding: the p95 criterion needs a staging environment with dedicated
hardware.** It is recorded here and in the README as open, not as done.

## Decision 5: recently viewed and saved searches are scoped in the service

Both tables are platform-owned with no RLS, because buyers are not tenants
(PRD 6.2) and there is no tenant to scope them to - the same treatment `sessions`
has had since Phase 1. **Every query filters on the authenticated user id, and
the filter appears in every method rather than in a helper somebody could
forget.** The delete filters on both the id and the user id, and there is a test
that one user cannot delete another's saved search.

Recently-viewed is one row per user per product, updated in place and trimmed on
write. A log of every view would grow without bound to answer a question nobody
asks.

## Known gaps, stated rather than hidden

- **"Frequently bought together" is not implemented.** It needs order history,
  which is Phase 4. A random sample presented as a recommendation would be worse
  than its absence. "Similar products" *is* implemented - same category, ranked
  by shared attribute values - and "other sellers for this item" is the buy box.
- **Saved-search alerts do not exist.** The searches are saved; nothing emails
  anyone. Notifications are Phase 9, and the schema deliberately has no
  `alerts_enabled` column that does nothing.
- **Best-selling sort** needs orders. The sort enum does not offer it, rather
  than offering it and returning something else.
- **Search is English-stemmed.** PRD 10.6 owns i18n; the analyser name appears
  in exactly one place, so a Bangla configuration is a change to the view plus a
  reindex.

## Related

- `packages/db/migrations/0009_search_tables.sql`, `0010_search_index.sql`
- `packages/db/src/search-index.ts`, `src/schema/search.ts`, `src/seed/search.ts`
- `apps/api/src/modules/search/`, `apps/api/src/common/tenant-scope.ts`
- `apps/api/test/search.e2e.test.ts`, `search-perf.e2e.test.ts`
- ADR 0011 (why the tenant gate on an extra policy exists), ADR 0014 (the buy box
  whose eligibility rule the view restates)
