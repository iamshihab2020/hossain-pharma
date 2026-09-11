import { describe, expect, it } from 'vitest';
import { money } from './money.js';
import {
  VOLUMETRIC_DIVISOR_CM3_PER_KG,
  chargeableWeightGrams,
  deliveryWindow,
  mergeWindows,
  rateFor,
  sumRates,
  volumetricWeightGrams,
} from './logistics.js';

const BANDS = [
  { maxWeightGrams: 500, amount: money(4_000, 'BDT') },
  { maxWeightGrams: 1_000, amount: money(6_000, 'BDT') },
  { maxWeightGrams: 5_000, amount: money(12_000, 'BDT') },
];

describe('volumetricWeightGrams', () => {
  it('bills a 10cm cube at 200g', () => {
    // The worked example from the doc comment, kept as a test so the unit
    // conversion has a witness rather than a claim: 1000 cm³ / 5000 = 0.2 kg.
    expect(volumetricWeightGrams({ lengthMm: 100, widthMm: 100, heightMm: 100 })).toBe(200);
  });

  it('rounds UP, so a parcel on a band boundary is never a band too cheap', () => {
    // 1 mm³ over the 200 g mark. Rounding down would quote this at 200 g
    // exactly - and if a band ended there, one band too low.
    expect(volumetricWeightGrams({ lengthMm: 100, widthMm: 100, heightMm: 101 })).toBe(202);

    // The smallest possible box still costs something.
    expect(volumetricWeightGrams({ lengthMm: 1, widthMm: 1, heightMm: 1 })).toBe(1);
  });

  it('is the divisor it names', () => {
    const litre = { lengthMm: 100, widthMm: 100, heightMm: 100 };
    expect(volumetricWeightGrams(litre)).toBe(
      Math.ceil((100 * 100 * 100) / VOLUMETRIC_DIVISOR_CM3_PER_KG),
    );
  });

  it.each([
    ['lengthMm', { lengthMm: 0, widthMm: 10, heightMm: 10 }],
    ['widthMm', { lengthMm: 10, widthMm: -1, heightMm: 10 }],
    ['heightMm', { lengthMm: 10, widthMm: 10, heightMm: 1.5 }],
  ])('refuses a non-positive integer %s', (name, dimensions) => {
    expect(() => volumetricWeightGrams(dimensions)).toThrow(new RegExp(name));
  });
});

describe('chargeableWeightGrams', () => {
  it('bills the duvet by volume and the battery by mass', () => {
    // A big light box: 40 x 40 x 40 cm = 64000 cm³ = 12.8 kg volumetric, for
    // something that actually weighs 1.2 kg. This is the case dimensions exist
    // for - without it the platform funds the van space out of commission.
    const duvet = { lengthMm: 400, widthMm: 400, heightMm: 400 };
    expect(chargeableWeightGrams(1_200, duvet)).toBe(12_800);

    // A small heavy one goes the other way and bills its mass.
    const battery = { lengthMm: 60, widthMm: 40, heightMm: 20 };
    expect(chargeableWeightGrams(900, battery)).toBe(900);
  });

  it('bills actual weight when the box was never measured', () => {
    // The honest answer for a catalogue that predates the columns. Anything
    // else over-charges a seller for a measurement nobody took.
    expect(chargeableWeightGrams(750, null)).toBe(750);
  });

  it('takes either side when they are equal', () => {
    const cube = { lengthMm: 100, widthMm: 100, heightMm: 100 };
    expect(chargeableWeightGrams(200, cube)).toBe(200);
  });

  it('refuses a non-positive actual weight', () => {
    expect(() => chargeableWeightGrams(0, null)).toThrow(/actualGrams/);
  });
});

describe('rateFor', () => {
  it('picks the narrowest band the parcel fits', () => {
    expect(rateFor(BANDS, 1)).toEqual(money(4_000, 'BDT'));
    expect(rateFor(BANDS, 400)).toEqual(money(4_000, 'BDT'));
  });

  it('treats the band bound as INCLUSIVE', () => {
    // 500 g goes in the 500 g band, not the next one up. An exclusive bound
    // here is a whole band of parcels quietly quoted one tier high.
    expect(rateFor(BANDS, 500)).toEqual(money(4_000, 'BDT'));
    expect(rateFor(BANDS, 501)).toEqual(money(6_000, 'BDT'));
  });

  it('returns null above the heaviest band rather than extrapolating', () => {
    // The ceiling is a real answer: this needs freight. Returning the top band
    // would quote a piano at suitcase rates and find out at the depot.
    expect(rateFor(BANDS, 5_001)).toBeNull();
  });

  it('returns null for an empty rate card', () => {
    expect(rateFor([], 100)).toBeNull();
  });

  it('does not depend on the order the bands arrive in', () => {
    const shuffled = [BANDS[2], BANDS[0], BANDS[1]] as typeof BANDS;
    expect(rateFor(shuffled, 600)).toEqual(money(6_000, 'BDT'));
  });

  it('refuses a non-positive weight', () => {
    expect(() => rateFor(BANDS, 0)).toThrow(/chargeableGrams/);
  });
});

describe('sumRates', () => {
  it('adds the parcels a multi-warehouse group produces', () => {
    expect(sumRates([money(4_000, 'BDT'), money(6_000, 'BDT')])).toEqual(money(10_000, 'BDT'));
  });

  it('returns null for no parcels', () => {
    expect(sumRates([])).toBeNull();
  });

  it('refuses to mix currencies rather than taking the first', () => {
    expect(() => sumRates([money(4_000, 'BDT'), money(10, 'USD')])).toThrow(/BDT and USD/);
  });
});

describe('deliveryWindow', () => {
  it('adds the seller dispatch time to the zone transit time', () => {
    expect(deliveryWindow(1, 2, 4)).toEqual({ earliestDays: 3, latestDays: 5 });
  });

  it('allows same-day dispatch and same-day transit', () => {
    expect(deliveryWindow(0, 0, 0)).toEqual({ earliestDays: 0, latestDays: 0 });
  });

  it('refuses an inverted transit range', () => {
    expect(() => deliveryWindow(1, 5, 2)).toThrow(/exceeds/);
  });

  it.each([
    ['dispatchDays', -1, 1, 2],
    ['transitDaysMin', 1, -1, 2],
    ['transitDaysMax', 1, 1, 1.5],
  ])('refuses a negative or fractional %s', (name, dispatch, min, max) => {
    expect(() => deliveryWindow(dispatch, min, max)).toThrow(new RegExp(name));
  });
});

describe('mergeWindows', () => {
  it('spans from the soonest earliest to the slowest latest', () => {
    // The basket is not complete until the last parcel lands, so the merge
    // widens rather than averages.
    expect(
      mergeWindows([
        { earliestDays: 3, latestDays: 5 },
        { earliestDays: 1, latestDays: 9 },
        { earliestDays: 4, latestDays: 6 },
      ]),
    ).toEqual({ earliestDays: 1, latestDays: 9 });
  });

  it('returns the single window unchanged', () => {
    expect(mergeWindows([{ earliestDays: 2, latestDays: 3 }])).toEqual({
      earliestDays: 2,
      latestDays: 3,
    });
  });

  it('returns null for an empty basket', () => {
    expect(mergeWindows([])).toBeNull();
  });
});
