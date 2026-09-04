import type { Money } from './money.js';

/**
 * PRD 8.3, the buy box — the ranking that decides which seller's offer a buyer
 * sees first on a shared product page.
 *
 * Deliberately a pure function over plain data, in a framework-free package:
 * it is the piece of Phase 2 most likely to be tuned, and tuning something that
 * needs a database and an HTTP request to exercise is how ranking logic ends up
 * untested.
 */
export type OfferInput = {
  readonly listingId: string;
  readonly tenantId: string;
  readonly price: Money;
  /**
   * Flat per-listing shipping. PHASE 2 ONLY.
   *
   * PRD 8.3 ranks by landed price — price plus shipping *to the buyer's zone*.
   * Delivery zones are Phase 6. Ranking on a flat figure is the honest
   * approximation available now, and `BUY_BOX_BASIS` exists so the API can say
   * which one it used rather than letting a client assume the richer one.
   */
  readonly shipping: Money;
  readonly dispatchDays: number;
  readonly availableStock: number;
  /**
   * 0–5, or null where the seller has no ratings yet.
   *
   * There are no reviews until Phase 7, so today this is null for everyone and
   * the second ranking key never breaks a tie. It is implemented and tested
   * with synthetic values anyway — a ranking key added later, under time
   * pressure, next to a live buy box is worse than one that is already correct
   * and currently inert.
   */
  readonly sellerRating: number | null;
  readonly listingStatus: string;
  readonly sellerStatus: string;
};

export type RankedOffer = OfferInput & {
  readonly landedPrice: Money;
  readonly isWinner: boolean;
};

export type BuyBox = {
  readonly winner: RankedOffer | null;
  readonly offers: readonly RankedOffer[];
  readonly basis: typeof BUY_BOX_BASIS;
  readonly otherSellerCount: number;
};

/**
 * Named so it can travel in the API response. A client that renders "delivered
 * price" must be able to tell that Phase 2 has not quoted their address.
 */
export const BUY_BOX_BASIS = 'flat-shipping' as const;

/**
 * PRD 8.3: "Ineligible if out of stock, seller suspended, or listing paused."
 *
 * A SUSPENDED seller is excluded even though PRD 6.6 lets them keep fulfilling
 * open orders — suspension withdraws *selling*, and appearing in a buy box is
 * selling. The two rules agree: finish what is sold, sell nothing new.
 */
export function isEligible(offer: OfferInput): boolean {
  return (
    offer.listingStatus === 'ACTIVE' && offer.sellerStatus === 'ACTIVE' && offer.availableStock > 0
  );
}

export function landedPrice(offer: OfferInput): Money {
  assertSameCurrency(offer.price, offer.shipping);
  return { amount: offer.price.amount + offer.shipping.amount, currency: offer.price.currency };
}

/**
 * Ranks the offers for one variant and names a winner. The ordering itself is
 * documented on `compare` below.
 *
 * Ineligible offers are dropped, not ranked last: an out-of-stock offer at a
 * lower price is not an offer, and showing it as one invites the buyer to
 * believe a price they cannot pay.
 */
export function rankOffers(offers: readonly OfferInput[]): BuyBox {
  // Destructured rather than indexed, and the winner is computed rather than
  // read off `sorted[0]`. Both are so that every branch in this function is
  // reachable from a test - an `offers[0] ?? null` whose null case cannot
  // happen is an untestable branch, and the 100% threshold on this file exists
  // to mean something.
  const [first, ...rest] = offers.filter(isEligible);
  if (first === undefined) {
    return { winner: null, offers: [], basis: BUY_BOX_BASIS, otherSellerCount: 0 };
  }

  // Comparing landed prices across currencies is meaningless, and a silent
  // conversion at a made-up rate is worse than a refusal. PRD 10.6 owns
  // multi-currency; until then, one product page is one currency.
  for (const offer of rest) {
    if (offer.price.currency !== first.price.currency) {
      throw new Error(
        `Cannot rank offers across currencies: ${first.price.currency} and ${offer.price.currency}`,
      );
    }
  }

  const best = rest.reduce((current, offer) => (compare(offer, current) < 0 ? offer : current), first);
  const others = [first, ...rest]
    .filter((offer) => offer.listingId !== best.listingId)
    .sort(compare)
    .map((offer) => rank(offer, false));
  const winner = rank(best, true);

  return {
    winner,
    offers: [winner, ...others],
    basis: BUY_BOX_BASIS,
    // PRD 9.1: "N other sellers from X".
    otherSellerCount: others.length,
  };
}

/**
 * Landed price ascending, then seller rating descending, then dispatch days
 * ascending, then available stock descending, then listing id ascending.
 *
 * THE LAST KEY IS NOT COSMETIC. Without a total order, two offers equal in
 * every other field swap places between requests, so the buy box flickers, the
 * winner shown on the page differs from the one add-to-cart resolves, and
 * nobody can reproduce it. Listing ids are unique, so `< ? -1 : 1` is total -
 * there is deliberately no third case for equal ids, because there are none.
 */
function compare(a: OfferInput, b: OfferInput): number {
  const byPrice = landedPrice(a).amount - landedPrice(b).amount;
  if (byPrice !== 0) return byPrice;

  // null sorts last: an unrated seller does not beat a rated one on a tie.
  const byRating = (b.sellerRating ?? -1) - (a.sellerRating ?? -1);
  if (byRating !== 0) return byRating;

  const byDispatch = a.dispatchDays - b.dispatchDays;
  if (byDispatch !== 0) return byDispatch;

  const byStock = b.availableStock - a.availableStock;
  if (byStock !== 0) return byStock;

  return a.listingId < b.listingId ? -1 : 1;
}

function rank(offer: OfferInput, isWinner: boolean): RankedOffer {
  return { ...offer, landedPrice: landedPrice(offer), isWinner };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} and ${b.currency}`);
  }
}
