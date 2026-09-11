import { describe, expect, it } from 'vitest';
import { money } from '@nexmarket/shared';
import { FREE_SHIPPING_THRESHOLD_MINOR, FlatRateShippingAdapter, FLAT_RATE_MINOR } from './flat-rate.adapter.js';
import { ZoneRateShippingAdapter, basisFor } from './zone-rate.adapter.js';
import type { QuoteZone, ShippingQuoteRequest } from './shipping-quote.port.js';

/**
 * A unit test, and it can be one only because the port stayed pure.
 *
 * Phase 6 could have made `quote` async and let the adapter read zone_rates
 * itself; every case below would then have needed a database and a fixture. The
 * caller resolving the zone instead is what keeps the volumetric cliff, the
 * over-ceiling parcel and the unserviceable postcode as arithmetic.
 */
const DHAKA: QuoteZone = {
  id: 'zone-1',
  code: 'BD-DHAKA-METRO',
  name: 'Dhaka metro',
  areaName: 'Dhanmondi, Dhaka',
  codAllowed: true,
  transitDaysMin: 1,
  transitDaysMax: 2,
  bands: [
    { maxWeightGrams: 500, amount: money(6_000, 'BDT') },
    { maxWeightGrams: 1_000, amount: money(8_000, 'BDT') },
    { maxWeightGrams: 5_000, amount: money(16_000, 'BDT') },
  ],
};

function request(overrides: Partial<ShippingQuoteRequest> = {}): ShippingQuoteRequest {
  return {
    sellerId: 'seller-1',
    subtotal: money(20_000, 'BDT'),
    itemCount: 1,
    postcode: '1205',
    countryCode: 'BD',
    zone: DHAKA,
    chargeableGrams: 400,
    ...overrides,
  };
}

const adapter = new ZoneRateShippingAdapter(new FlatRateShippingAdapter());

describe('ZoneRateShippingAdapter', () => {
  it('charges the band the parcel falls into', () => {
    expect(adapter.quote(request({ chargeableGrams: 400 }))).toEqual(money(6_000, 'BDT'));
    expect(adapter.quote(request({ chargeableGrams: 900 }))).toEqual(money(8_000, 'BDT'));
    expect(adapter.quote(request({ chargeableGrams: 4_000 }))).toEqual(money(16_000, 'BDT'));
  });

  it('charges nothing for an empty group', () => {
    expect(adapter.quote(request({ itemCount: 0 }))).toEqual(money(0, 'BDT'));
  });

  it('honours the free-shipping threshold WHATEVER the parcel weighs', () => {
    // The threshold is the platform's promise, and a heavy order is exactly
    // where quietly withdrawing it would cost the buyer most.
    const heavy = request({
      subtotal: money(FREE_SHIPPING_THRESHOLD_MINOR, 'BDT'),
      chargeableGrams: 4_900,
    });
    expect(adapter.quote(heavy)).toEqual(money(0, 'BDT'));
    expect(basisFor(heavy)).toBe('free-shipping-threshold');
  });

  it('reports an empty group as shipping nothing, not as a free-shipping win', () => {
    // Zero items at or above the threshold is a cart with nothing in it, not a
    // qualifying order, and it is not a zone rate either. Both functions have
    // to agree on that, which the first version did not.
    const empty = request({ subtotal: money(FREE_SHIPPING_THRESHOLD_MINOR, 'BDT'), itemCount: 0 });
    expect(adapter.quote(empty)).toEqual(money(0, 'BDT'));
    expect(basisFor(empty)).toBe('no-items');
  });

  describe('falls back to the flat rate, visibly', () => {
    it('when the postcode serves no zone', () => {
      // The buy box still ranks on landed price for a visitor who has not said
      // where they are, so this needs a number rather than an exception.
      const unserviceable = request({ zone: null });
      expect(adapter.quote(unserviceable)).toEqual(money(FLAT_RATE_MINOR, 'BDT'));
      expect(basisFor(unserviceable)).toBe('flat-shipping');
    });

    it('when a line in the group was never measured', () => {
      const unmeasured = request({ chargeableGrams: null });
      expect(adapter.quote(unmeasured)).toEqual(money(FLAT_RATE_MINOR, 'BDT'));
      expect(basisFor(unmeasured)).toBe('flat-shipping');
    });

    it('when the parcel is over the rate card ceiling', () => {
      // Above the heaviest band a rate card has no opinion. Extrapolating the
      // top band would quote a piano at suitcase rates.
      const overweight = request({ chargeableGrams: 5_001 });
      expect(adapter.quote(overweight)).toEqual(money(FLAT_RATE_MINOR, 'BDT'));
      expect(basisFor(overweight)).toBe('flat-shipping');
    });

    it('when the rate card is in another currency', () => {
      // A misconfiguration, not something to convert - converting would put a
      // floating-point exchange rate in a money path.
      const mismatched = request({
        zone: { ...DHAKA, bands: [{ maxWeightGrams: 500, amount: money(50, 'USD') }] },
      });
      expect(adapter.quote(mismatched)).toEqual(money(FLAT_RATE_MINOR, 'BDT'));
      expect(basisFor(mismatched)).toBe('flat-shipping');
    });
  });

  it('reports the zone-rate basis when it used the rate card', () => {
    expect(basisFor(request())).toBe('zone-rate');
  });

  /**
   * `quote` and `basisFor` are two functions over the same inputs, so they can
   * disagree. This walks the same cases through both and asserts they cannot:
   * whenever the basis says 'zone-rate' the amount must be a band's amount, and
   * whenever it says 'flat-shipping' it must be the flat rate.
   */
  it('never reports a basis the amount contradicts', () => {
    const cases: ShippingQuoteRequest[] = [
      request(),
      request({ zone: null }),
      request({ chargeableGrams: null }),
      request({ chargeableGrams: 5_001 }),
      request({ subtotal: money(FREE_SHIPPING_THRESHOLD_MINOR, 'BDT') }),
      request({ itemCount: 0 }),
    ];

    for (const input of cases) {
      const amount = adapter.quote(input);
      const basis = basisFor(input);

      if (basis === 'zone-rate') {
        expect(DHAKA.bands.map((b) => b.amount.amount)).toContain(amount.amount);
      }
      if (basis === 'flat-shipping' && input.itemCount > 0) {
        expect(amount.amount).toBe(FLAT_RATE_MINOR);
      }
      if (basis === 'free-shipping-threshold' || basis === 'no-items') {
        expect(amount.amount).toBe(0);
      }
    }
  });
});
