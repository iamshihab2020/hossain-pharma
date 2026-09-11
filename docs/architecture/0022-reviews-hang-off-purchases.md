# 0022 — Reviews hang off purchases, and the histogram is the only stored rating

**Status:** accepted
**Date:** 2026-09-11
**Phase:** 7 (Trust)
**Spec:** PRD §11 Phase 7, §9.5, §8.3
**Supersedes nothing. Extends:** [0010](./0010-denormalised-columns-have-one-writer.md),
[0021](./0021-geography-is-platform-owned.md)

---

## 1. Reviews are platform-owned, with no RLS

The third application of the argument in ADR 0021, and it is the same argument
each time: **who reads this, and do they have a tenant?**

PRD §9.5 puts the aggregated rating and the review distribution on the product
page. That page is opened by an anonymous shopper who has no session, no
`x-tenant-id` header and has chosen no seller — the same reader the catalogue
was made platform-owned for in Phase 2 and the delivery-zone tables in Phase 6.
A tenant-owned `reviews` table answers that reader with **zero rows**, and does
it silently: the page renders "No reviews yet" on a product with four hundred of
them and nothing errors.

So `reviews`, `product_ratings` and `seller_ratings` carry no policies, and
`packages/db/src/reviews-rls.test.ts` asserts that rather than trusting this
paragraph. The test reads the product page's rows twice — once with no tenant
and once with a tenant selected — because a seller browsing the storefront
carries their own tenant, and a policy appearing later would show them a product
page containing only their own reviews.

**The service is therefore the entire boundary**, and it is a different boundary
on each verb, which is why none of them shares a helper that could be applied to
the wrong one:

| Verb | Boundary | Where |
|---|---|---|
| Read a product's reviews | none — public content | `@Public()` controller |
| Write, edit, delete | `ctx.userId`, matched against the order line | `ReviewsService` |
| Moderate | platform admin | `@PlatformAdmin()` controller |
| Report | none — see §5 | `@Public()` controller |

Moderation being on a platform-admin controller is load-bearing rather than
tidy. **A seller able to remove a review of their own product is the worst
failure mode this feature has**, and keeping the verb off any organisation-scoped
route makes it structurally impossible instead of a rule somebody follows.

## 2. A review hangs off an ORDER LINE, not off a product with a flag

PRD §4.3's acceptance is "only delivered purchases can review". The obvious
shape — a `reviews` table keyed by product, with a `verified` boolean — makes
that a claim the write path has to remember to check and every later reader has
to trust.

`reviews.order_item_id` is a foreign key to the line somebody actually bought,
and it cannot be forged. Three separate mechanisms then implement the criterion,
and only one of them is code anybody could break:

1. **It is yours** — `orders.buyer_user_id = ctx.userId`, a predicate in the
   query that resolves the line.
2. **It arrived** — `orders.status = 'DELIVERED'`, read at WRITE time rather
   than trusted from whatever the page believed when it rendered.
3. **Once** — `reviews_order_item_key UNIQUE`. A constraint, not a prior
   `SELECT`, for the reason every idempotency rule in this codebase is one: two
   concurrent submissions both pass a lookup.

The **product is derived from the line**, never accepted from the body. A caller
naming both could review one thing on the strength of having bought another, and
the verified-purchase guarantee is precisely what would become worthless.

`order_items` carries `listing_id` and no product reference, so `product_id` is
resolved once at write time and stored. That is not only the cheaper read: a
listing can be ARCHIVED, and a review of a product must outlive the offer that
happened to sell it.

## 3. The histogram is the value; nothing derived is stored

`product_ratings` and `seller_ratings` hold **five integers and nothing else**.
The count, the average and every bar on the distribution chart fall out of them,
so an average stored beside the counts would be a second source of truth for one
fact — and ADR 0010 exists because this codebase has been bitten twice by a
denormalised column with two writers.

Three consequences, all deliberate:

- **One writer.** `ReviewAggregateService`, the same arrangement
  `SearchIndexService` has with `search_documents`. It takes the caller's
  transaction, so the aggregate commits with the review that caused it — a
  review written and an aggregate that failed afterwards would leave the page
  showing a rating that disagrees with the reviews printed under it, and nothing
  would notice.
- **Full recompute, never an increment.** A `+1` on insert and a `-1` on delete
  is smaller and is how aggregates drift: an edit is a decrement and an
  increment that must both land, a moderation is a decrement that must not run
  twice. Recomputing one product's five integers reads a handful of rows behind
  an index, and PRD Phase 7's second acceptance criterion — "aggregates
  recompute correctly on edit/delete" — stops being a behaviour to test and
  becomes the only thing the code can do.
- **A drift query, in `review-aggregates.ts` beside the statements it checks.**
  Not in the test: a comparison written inside a test is a second definition of
  the aggregate and it will agree with the bug.

`averageRating` returns **null**, never 0, for an empty histogram. Those are
different facts and the buy box already depends on the difference — see §4.

## 4. One review counts twice, and the buy box finally has a rating

A review counts once against the catalogue entry and once against whoever
fulfilled it. That is a decision worth naming: a marketplace where competing
sellers share one product page has **no separate "rate the seller" moment** that
buyers would reliably complete, and a seller score nobody fills in leaves PRD
§8.3's second ranking key permanently null — which is exactly what it has been
since Phase 2, with a comment in `catalogue.service.ts` saying so.

The consequence to keep in mind: **a seller carrying a badly-reviewed product is
marked down for it.** That is arguably correct on a marketplace where the seller
chose which catalogue entry to list against, and Phase 10's fulfilment metrics
are where delivery performance gets measured separately.

The rating reaches the buy box as a `LEFT JOIN` on `seller_ratings`, selected as
the five counts and averaged by the shared function — not computed in SQL, which
would be a second definition of what a rating is. Left, because an unrated
seller must still have an offer; null, because an unrated seller sorts BEHIND a
rated one rather than below a one-star.

## 5. A report is an accusation, not a verdict

`review_status` has three values and the middle one is the decision.

**FLAGGED is still visible.** Hiding content the moment somebody objects hands a
heckler's veto to whoever complains first, and on a marketplace the first
complainer is usually the seller the review is about. A flagged review stays on
the page, carries a line saying it has been reported, and enters the moderation
queue. Only a human moving it to REMOVED takes it down.

**REMOVED is invisible on every surface** — the product list, the histogram, the
seller's score, the buy-box tiebreak. That is PRD Phase 7's third acceptance
criterion, and it holds because every read filters the status AND the moderation
path refreshes the aggregate. The second half is the one that would be missed:
the list filters `REMOVED` on its own, so dropping the aggregate refresh would
leave the first surface working and hide the failure of the rest.

**Reporting is the one public write in the module.** Requiring an account to
report abuse means the abuse stays up while the person who noticed it registers,
and the people best placed to spot a fake review are shoppers reading the page
rather than the one buyer who wrote it. What makes it safe to leave open is that
it cannot destroy anything: it flags, it does not hide, and it moves only a
PUBLISHED review — so no volume of reports can undo a moderator, and the worst a
brigade achieves is putting a review in front of a human.
`route-coverage.e2e.test.ts` demands that justification in writing, which is why
it is also recorded there.

**Moderation is a status; the author's own deletion is a DELETE.** Two verbs,
two mechanisms, on purpose: a person withdrawing their own words should leave
nothing behind, while a moderator taking somebody else's down is an act that has
to stay auditable and reversible — and Phase 11's audit log will want the row.

## 6. What this does not do

| Not here | Why |
|---|---|
| Review photos | The `StorageProvider` port exists and product media already uses it. Photos are additive to this shape and need no decision from it. |
| Helpful voting | A second table keyed by (review, user). Additive; nothing above changes. |
| Product Q&A | Its own pair of tables. Shares the platform-owned reasoning and none of the purchase-verification machinery — a question is not a purchase. |
| Seller storefront pages | `seller_ratings` is the data they need and it exists now. The page is a route, not a decision. |
| Auto-flagging | Deliberately last. Rules that move content need the moderation queue to exist first, and the queue is what tells you which rules would have been right. |
| Seeded review data | PRD §4.3 S5 wants 300 reviews, which needs 200 seeded ORDERS first — reviews hang off order lines and the seed creates none. That is S5's piece of work, not this one. |
