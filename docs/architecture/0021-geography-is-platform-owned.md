# ADR 0021 - Geography is platform-owned, and the shipping port stays pure

**Status:** accepted
**Date:** 2026-09-11
**Phase:** 6
**Implements:** PRD 8.4 (delivery estimate and serviceability before add-to-cart),
9.1 ("COD where the zone allows it"), 10.3 (`ShippingProvider` port), 11 Phase 6.

## Context

Phase 6 introduces four tables — `delivery_zones`, `serviceability`,
`zone_rates`, `delivery_slots` — and every table added since Phase 1 has had to
answer the same question first: tenant-owned or platform-owned? Getting it wrong
is not a performance problem. A tenant-owned table read without a tenant returns
**zero rows and no error**, which is the failure mode `CLAUDE.md` warns about
three separate times.

## Decision 1: all four tables are platform-owned, with no RLS

The forcing constraint is PRD 8.4: the delivery estimate and the serviceability
check go on the **product page, before add-to-cart**, for a visitor who is not
signed in, has no address book, and has chosen no seller. That page runs with no
`app.tenant_id`. A tenant-owned zone table would return nothing to precisely the
reader the feature exists for.

For `zone_rates` there is a second and stronger reason. The buy box ranks
competing offers on **landed** price, so it adds shipping to every seller's
sticker price in one pass over public rows. Per-seller rate cards would make that
ranking unresolvable for a signed-out buyer: N sellers means N tenant contexts,
and the page has none. A platform rate card per (zone, weight band) keeps landed
price computable from rows an anonymous reader can already see.

This is the same call the catalogue got in migration 0007 and for the same
reason. Seller-funded shipping promotions are Phase 9 and ride on top as a
discount, not as a second rate card.

`warehouses` stays **tenant-owned** and was extended in place, as its Phase 2
comment promised. What belongs there is the seller's facts about the seller's
own building.

## Decision 2: serviceability is a table of covered postcodes, not a rule

A prefix rule or a range expression computes a zone for every input and can
therefore never say *no*. PRD 8.4 wants the negative answer as a first-class
outcome, so **a missing row is the answer**: "no courier covers 5820 yet."

The seed is deliberately not exhaustive — about twenty of Bangladesh's ~700
postcodes. The gaps are the feature; without them the unserviceable branch has
no way to be demonstrated.

## Decision 3: weights live on the VARIANT

PRD Phase 6 asks for "weight/dimensional rate cards", and nothing in the schema
carried a weight. It went on `product_variants` rather than `listings` because
PRD 8.3 shares a catalogue entry between competing sellers, and two sellers of
the same phone ship the same box. On the offer it would be a lever on landed
price unrelated to service — one seller declaring 400 g and another 4 kg for
identical goods.

The columns are nullable, with a `num_nonnulls(...) IN (0, 3)` check: all three
dimensions or none. Two of three cannot produce a volume, and a partially
measured box that silently skips the volumetric comparison is the failure worth
making unrepresentable.

## Decision 4: the quote port stayed SYNCHRONOUS and database-free

The obvious implementation was to make `ShippingQuoteProvider.quote` async and
let the adapter read `zone_rates` itself. That would have put a round trip inside
a per-seller-group loop on the checkout path, which PRD 13 budgets at
p95 < 500 ms — and it would have made every interesting case need a fixture.

Instead the **caller** resolves the postcode to a zone once per quote and hands
the rate card in. The adapter remains a pure function of its arguments, so the
volumetric cliff, the over-ceiling parcel, the unmeasured variant and the
unserviceable postcode are unit tests rather than integration ones.

`FlatRateShippingAdapter` was kept, not deleted. The zone adapter injects it and
falls back for three real gaps — no zone, no measurement, over the ceiling — and
the fallback is **visible** in the quote's `shippingBasis`, so nothing downstream
mistakes a flat rate for a zone rate. Same discipline as `BUY_BOX_BASIS`.

## Decision 5: COD is withdrawn by ZONE, and enforced on the server

`delivery_zones.cod_allowed` is a property of geography: a courier that will not
carry cash back from a district is why the option disappears. The storefront
hides the radio; `CheckoutService.assertCodAllowed` refuses the order. A payment
method arrives in a request body, and the rule deciding whether money can be
collected at the door cannot live in a radio button.

An **unserviceable** address does not fail that check — only a zone that exists
and says no. Refusing COD because the rate card has no row for an address would
withdraw the country's most common payment method on the strength of a seed gap.

## Consequences

- The buy box still advertises `basis: 'flat-shipping'`. It ranks without an
  address and has none to quote against; the product page's delivery check is
  where a real rate appears, and checkout is where it binds.
- `order_status` still has no `OUT_FOR_DELIVERY`. It arrives with the tracking
  adapter, not with geography.
- COD orders still cannot be fulfilled. Collection is the other half of Phase 6
  and is not built yet.

## Related

- `packages/db/src/schema/logistics.ts` — the four tables and their reasoning
- `packages/shared/src/logistics.ts` — volumetric weight, bands, windows
- `apps/api/src/modules/shipping/` — the port, both adapters, serviceability
- ADR 0016 — the ledger's platform-owned/org-scoped precedent
- ADR 0018 — cash on delivery as a first-class payment method
