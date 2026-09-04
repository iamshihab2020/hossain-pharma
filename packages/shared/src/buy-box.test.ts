import { describe, expect, it } from 'vitest';
import { BUY_BOX_BASIS, isEligible, landedPrice, rankOffers, type OfferInput } from './buy-box.js';

const BDT = 'BDT';

function offer(over: Partial<OfferInput> & { listingId: string }): OfferInput {
  return {
    tenantId: `tenant-${over.listingId}`,
    price: { amount: 100_00, currency: BDT },
    shipping: { amount: 0, currency: BDT },
    dispatchDays: 1,
    availableStock: 5,
    sellerRating: null,
    listingStatus: 'ACTIVE',
    sellerStatus: 'ACTIVE',
    ...over,
  };
}

describe('eligibility', () => {
  it('accepts an active listing from an active seller with stock', () => {
    expect(isEligible(offer({ listingId: 'a' }))).toBe(true);
  });

  it('rejects an offer with no stock', () => {
    expect(isEligible(offer({ listingId: 'a', availableStock: 0 }))).toBe(false);
  });

  it('rejects a paused, draft or archived listing', () => {
    for (const status of ['DRAFT', 'PENDING_REVIEW', 'PAUSED', 'ARCHIVED']) {
      expect(isEligible(offer({ listingId: 'a', listingStatus: status }))).toBe(false);
    }
  });

  it('rejects a suspended seller', () => {
    // PRD 6.6 lets a suspended seller finish open orders. Appearing in a buy box
    // is not finishing an order, it is making a new sale.
    expect(isEligible(offer({ listingId: 'a', sellerStatus: 'SUSPENDED' }))).toBe(false);
  });

  it('rejects a seller who is not yet approved', () => {
    for (const status of ['DRAFT', 'PENDING_REVIEW', 'CLOSED']) {
      expect(isEligible(offer({ listingId: 'a', sellerStatus: status }))).toBe(false);
    }
  });
});

describe('landed price', () => {
  it('adds shipping to price', () => {
    const result = landedPrice(
      offer({
        listingId: 'a',
        price: { amount: 100_00, currency: BDT },
        shipping: { amount: 60_00, currency: BDT },
      }),
    );
    expect(result).toEqual({ amount: 160_00, currency: BDT });
  });

  it('refuses to add across currencies', () => {
    expect(() =>
      landedPrice(
        offer({
          listingId: 'a',
          price: { amount: 100, currency: 'BDT' },
          shipping: { amount: 100, currency: 'USD' },
        }),
      ),
    ).toThrow(/Currency mismatch/);
  });
});

describe('ranking', () => {
  it('gives the buy box to the cheaper of two sellers — the PRD 11 acceptance case', () => {
    const box = rankOffers([
      offer({ listingId: 'expensive', price: { amount: 40_000_00, currency: BDT } }),
      offer({ listingId: 'cheap', price: { amount: 38_500_00, currency: BDT } }),
    ]);
    expect(box.winner?.listingId).toBe('cheap');
    expect(box.offers.map((o) => o.listingId)).toEqual(['cheap', 'expensive']);
    expect(box.otherSellerCount).toBe(1);
    expect(box.basis).toBe(BUY_BOX_BASIS);
  });

  it('ranks on LANDED price, so shipping can flip the winner', () => {
    // The whole reason the key is landed price and not price. A cheaper item
    // with expensive shipping costs the buyer more.
    const box = rankOffers([
      offer({
        listingId: 'cheap-item-costly-post',
        price: { amount: 100_00, currency: BDT },
        shipping: { amount: 80_00, currency: BDT },
      }),
      offer({
        listingId: 'dearer-item-free-post',
        price: { amount: 150_00, currency: BDT },
        shipping: { amount: 0, currency: BDT },
      }),
    ]);
    expect(box.winner?.listingId).toBe('dearer-item-free-post');
  });

  it('drops an out-of-stock offer even when it is cheapest', () => {
    // Not "ranks it last". Showing an unbuyable price as an offer invites the
    // buyer to believe a price they cannot pay.
    const box = rankOffers([
      offer({
        listingId: 'out',
        price: { amount: 10_00, currency: BDT },
        availableStock: 0,
      }),
      offer({ listingId: 'in', price: { amount: 90_00, currency: BDT } }),
    ]);
    expect(box.offers.map((o) => o.listingId)).toEqual(['in']);
    expect(box.winner?.listingId).toBe('in');
    expect(box.otherSellerCount).toBe(0);
  });

  it('breaks a price tie on seller rating', () => {
    const box = rankOffers([
      offer({ listingId: 'unrated', sellerRating: null }),
      offer({ listingId: 'good', sellerRating: 4.8 }),
      offer({ listingId: 'poor', sellerRating: 2.1 }),
    ]);
    expect(box.offers.map((o) => o.listingId)).toEqual(['good', 'poor', 'unrated']);
  });

  it('breaks a price and rating tie on dispatch speed, then stock depth', () => {
    const box = rankOffers([
      offer({ listingId: 'slow', dispatchDays: 5, availableStock: 99 }),
      offer({ listingId: 'fast-thin', dispatchDays: 1, availableStock: 1 }),
      offer({ listingId: 'fast-deep', dispatchDays: 1, availableStock: 50 }),
    ]);
    expect(box.offers.map((o) => o.listingId)).toEqual(['fast-deep', 'fast-thin', 'slow']);
  });

  it('is deterministic for two offers that are identical in every ranked field', () => {
    // Without the listing-id tiebreaker the winner depends on input order, so
    // the buy box flickers between requests and nobody can reproduce it.
    const a = offer({ listingId: 'aaa' });
    const b = offer({ listingId: 'bbb' });
    expect(rankOffers([a, b]).winner?.listingId).toBe('aaa');
    expect(rankOffers([b, a]).winner?.listingId).toBe('aaa');
  });

  it('returns an empty box rather than throwing when nothing is eligible', () => {
    const box = rankOffers([offer({ listingId: 'a', availableStock: 0 })]);
    expect(box.winner).toBeNull();
    expect(box.offers).toEqual([]);
    expect(box.otherSellerCount).toBe(0);
  });

  it('handles a product with no offers at all', () => {
    expect(rankOffers([])).toEqual({
      winner: null,
      offers: [],
      basis: BUY_BOX_BASIS,
      otherSellerCount: 0,
    });
  });

  it('refuses to rank offers priced in different currencies', () => {
    // A silent comparison of 100 BDT against 100 USD picks a winner and is
    // wrong. PRD 10.6 owns multi-currency; until then this is a refusal.
    expect(() =>
      rankOffers([
        offer({ listingId: 'bdt', price: { amount: 100_00, currency: 'BDT' } }),
        offer({ listingId: 'usd', price: { amount: 100_00, currency: 'USD' } }),
      ]),
    ).toThrow(/across currencies/);
  });

  it('does not refuse a single offer, whatever its currency', () => {
    const box = rankOffers([
      offer({
        listingId: 'only',
        price: { amount: 5_00, currency: 'USD' },
        shipping: { amount: 1_00, currency: 'USD' },
      }),
    ]);
    expect(box.winner?.listingId).toBe('only');
    expect(box.winner?.landedPrice).toEqual({ amount: 6_00, currency: 'USD' });
  });

  it('marks exactly one winner', () => {
    const box = rankOffers([
      offer({ listingId: 'a', price: { amount: 1_00, currency: BDT } }),
      offer({ listingId: 'b', price: { amount: 2_00, currency: BDT } }),
      offer({ listingId: 'c', price: { amount: 3_00, currency: BDT } }),
    ]);
    expect(box.offers.filter((o) => o.isWinner)).toHaveLength(1);
    expect(box.offers[0]?.isWinner).toBe(true);
  });
});
