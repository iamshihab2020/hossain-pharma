# ADR 0020 - Dispatch releases the payable, and the allocation that makes it exact

**Status:** accepted
**Date:** 2026-09-10
**Phase:** 5
**Implements:** PRD 10.1 (ledger), 11 Phase 5 ("a partial shipment settles
correctly in the ledger"), 8.4 (Money).

## Context

Phase 4 settled everything at capture. `captureEntries` posted, per seller,
`PLATFORM_CLEARING` debit → `SELLER_PAYABLE` credit + commission, the moment the
webhook confirmed payment. Nothing about shipping moved money, because nothing
about shipping existed.

Phase 5's acceptance criterion is that **a partial shipment settles correctly in
the ledger**. Against the Phase 4 model that sentence has no content: a shipment
settles nothing, and the criterion could only be argued rather than asserted.

## Decision 1: a seller's payable is created by DISPATCH

`captureEntries` stops crediting sellers. A capture now posts one pair:

```
DR  buyer_receivable    total
CR  platform_clearing         total
```

and each dispatch posts the rest, for exactly the units in that parcel:

```
DR  platform_clearing              release
CR  seller_payable:<org>                 release − commission
CR  platform_revenue:commission          commission
```

The money sits in clearing in between, which is what clearing has always been
for - `ledger.ts` said so before this change was made: *"money received but not
yet attributed - which is exactly the state COD spends days in."* Dispatch is
the attribution.

**PRD 10.1's worked example is not edited to match the code.** Its eight lines
are still asserted verbatim in `ledger.test.ts`, now as the composition of
`captureEntries` plus `releaseEntries` per seller. What changed is *when* they
post, never what they are. That distinction is the reason the test survived the
change instead of being rewritten to agree with it.

**Card and COD converge.** `COD_ACCRUAL` already posted only a receivable and a
clearing credit (ADR 0016 decision 5), so both methods now leave the seller's
gross in the same place and release it through one code path. The payment method
stops being visible to fulfilment at all, which is the property that lets Phase
6's COD collection be a posting against `COD_RECEIVABLE` and nothing else.

Rejected: keeping Phase 4 semantics and calling a proportional reversal on
cancellation "settlement". It is cheaper, and it means the ledger says a seller
is owed for goods they have not sent.

## Decision 2: the share is allocated PER UNIT, once, up front

`gross` in a capture is `order.total` - subtotal **plus** order-level shipping
and tax. A parcel carries some units, not some fraction, so a release is an
amount computed at order level and then split. That is what `allocate()` is for,
and it is where it finally earns its place: Phase 4's plan (F-1) predicted it
would land at a cart-wide promotion or a partial refund, and a partial shipment
got there first.

**Recomputing a parcel's share as a fresh percentage of what it carries is
wrong, and silently so:**

```
unit price 1, quantity 3, commission 5000 bps
  the order records   commissionFor(3, 5000) = multiply(3, 0.5) = 1.5 → 2
  three per-unit roundings of 0.5, each away from zero            → 3
```

The platform takes 3 where it recorded 2. Every rounding boundary does this, in
whichever direction the last unit falls, and **nothing fails**: the entries
balance, the constraint trigger is satisfied, and the number is simply not the
one the order recorded. `fulfilment.test.ts` has a case named after it.

So `unitShares` allocates `order.total` and `order.commission_amount` across the
order's individual units once, weighted by unit price, and a parcel releases the
sum of its own units' shares. Units are consumed in index order, where a line's
next free unit is `shipped + cancelled` - so an amount is a **sum of fixed
per-unit shares** rather than a fresh rounding, no boundary is crossed twice, and
the parts sum to the recorded whole by construction. The final parcel closes the
order to zero outstanding with nothing left to chase.

Rejected: giving the last parcel whatever remainder is left. It reaches the same
total and puts the correction in the one place nobody audits, and the rule stops
holding the moment an order is cancelled mid-way.

## Decision 3: the release is STORED on the shipment

`shipments.release_amount` and `release_commission` record what that parcel
actually posted, rather than being recomputed on read.

This is the opposite of the `listings.available_stock` rule and for the same
underlying reason. There, the inventory rows are the truth and the column is a
cache, so a second writer causes drift. Here the shipment row **is** the truth:
the entries it produced are append-only and can never be edited, so a column that
could disagree with them after a rounding change would make the books arguable.

## Decision 4: cancellation reverses, and touches no seller

Cancelled units post a `REFUND` transaction returning their allocated share to
`BUYER_RECEIVABLE` from clearing. No seller entry appears, because a seller was
never credited for units that did not dispatch - the benefit of decision 1
showing up on its first use.

`transaction_kind` already carried `REFUND`. ADR 0016 predicted refunds would
need no schema change; Phase 5 is the first occasion to find out, and it was
true.

Actually returning money through the gateway stays Phase 8. `PaymentProvider`
grows no method here: a half-built refund path is worse than an honest ledger and
no path, and the amount owed is a balance anyone can query in the meantime.

## Consequences

- `SellerSplit` is deleted rather than kept for symmetry. A parameter that must
  be right for no reason is worse than no parameter.
- `packages/shared/src/fulfilment.ts` joins the 100 %-coverage list. It is
  arithmetic where a missed branch is money.
- Delivery posts **nothing**. It is the obvious place to look for a posting, so
  `markDelivered` says so in a comment.

## Related

- `packages/shared/src/fulfilment.ts`, `ledger.ts`, `money.ts` (`allocate`)
- `apps/api/src/modules/fulfilment/fulfilment.service.ts`
- `apps/api/test/fulfilment.e2e.test.ts` - the two-parcel exactness case
- ADR 0016 (the ledger), 0018 (the payment port), 0019 (cancellation)
