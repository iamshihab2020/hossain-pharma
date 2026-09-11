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

## 6. The rest of Phase 7, and the decisions each one needed

Everything below was added after the spine above, and each came with one
decision worth recording.

**Photos cascade from the review and are moderated with it.** A photo has no
meaning apart from the sentence it illustrates, so it is never listed or served
on its own — which means a REMOVED review makes its photos unreachable with
nothing extra to remember. `GET /reviews/media/:id` refuses a photo whose review
is removed, and that refusal is the point: it is the one surface nothing lists,
so a takedown that missed it would leave the pictures fetchable by anyone
holding an id and nobody would notice.

**Helpful votes get no denormalised counter, and that is the contrast with
ratings.** The pair (review, user) is the primary key, so voting is idempotent
by construction and un-voting is a `DELETE`. A rating is denormalised because
the BUY BOX ranks on it in a query over the whole catalogue that cannot afford
to reach into reviews; a helpful count is only ever shown on a page that has
already fetched the twenty reviews it belongs to. **Denormalise where the read
cannot afford the join, not everywhere the number appears.** Helpful only, with
no "unhelpful": a downvote on a marketplace review is a button for the seller
who disliked it, and the signal is indistinguishable from a genuinely poor
review.

**Asking a question needs no purchase, and that is why Q&A is a separate table
and a separate service.** A review is a verdict on something you received; a
question is what you ask BEFORE buying, so requiring an order would leave it
askable only by the people who no longer need to ask. Q&A therefore has no
verification to lean on and leans on moderation instead — same status enum, same
queue, same rule that a report flags rather than hides.

`answers.seller_org_id` is **nullable, and never inferred at read time**. On a
marketplace where several sellers list one product, "the seller replied" is
ambiguous until you say which, and a buyer weighing two offers wants to know
whether the answer came from the one they are considering. A boolean
`is_seller` would lose exactly that. It is verified against `org_members` when
written, because a header that promoted an answer to "the seller says" without a
membership check would make the badge worth nothing.

**Auto-flagging flags and can never hide or refuse.** PRD §9.6 asks for
profanity and velocity; a twenty-word list is wrong often enough that letting it
BLOCK would turn a moderation aid into a censorship bug with a scheduler, and an
honest buyer would be told their review was unacceptable by a regex. So a
flagged review is written, visible, and counted, with the reasons stored on the
row — `flag_reasons` is an array because the rules are independent and the
COMBINATION is the signal: a link alone is usually a mistake, a link plus a
flagged word plus the author's fourth review this hour is not. `RESTORE` clears
the array as well as the status, so a cleared review is distinguishable from one
nobody has reached yet.

What the word list is **not** is a profanity filter. Real ones are a service,
they are localised, and they lose to `f u c k`. The value here is that the seam
exists and is tested, so replacing it is one file.

**A suspended seller's storefront is a 404, not a page saying so.** A suspension
is an enforcement action, not a status page for the public, and their listings
are already invisible through `public_active_offers` — so the page would be an
empty shell with an explanation nobody is owed. Fulfilment stats and policies
are deliberately absent: dispatch performance is Phase 10's analytics work,
which has the order history to compute it honestly, and policies need a console
screen for a seller to write them.

## 7. What this still does not do

| Not here | Why |
|---|---|
| Image checks on review photos | PRD §9.6 lists it beside profanity and velocity. It needs a model or a service, and unlike the word list there is no honest twenty-line version — a stub here would claim something false. The seam is `autoFlagReasons`, which takes text today and can take a verdict later. |
| Seeded review data | PRD §4.3 S5 wants 300 reviews, which needs 200 seeded ORDERS first — reviews hang off order lines and the seed creates none. That is S5's piece of work. |
| Q&A on the seller console | A seller answers from the product page, acting as their organisation. A console inbox of unanswered questions is a Phase 10 tooling screen. |
| Review editing in the UI | The API takes it and the contract carries it; no screen calls it yet. A buyer who wants to change a review can delete and rewrite, which is one request more and zero screens more. |
