import { describe, expect, it } from 'vitest';
import type { Serviceability } from '@nexmarket/api-client';
import { formatWindow, marketToday, normalisePostcode, toAnswer } from './delivery';

/**
 * NODE environment, no DOM. See `order-timeline.test.ts` for why: the panel
 * this serves is markup over these functions, and the functions are where the
 * decisions live.
 */

// A SUNDAY. Named for the day it actually is, because the first version called
// it a Saturday and every expectation below was written one weekday out.
const SUN_13_SEP_2026 = new Date(Date.UTC(2026, 8, 13));

describe('marketToday', () => {
  it('gives the day it is in DHAKA, not the day it is in UTC', () => {
    // 22:30 UTC on 10 Sep is already 04:30 on 11 Sep in Dhaka. Reading a plain
    // `new Date()` with UTC getters put every delivery estimate one day early
    // through that window - between midnight and 06:00 local, which is exactly
    // when nobody is looking at it.
    const lateUtc = new Date('2026-09-10T22:30:00Z');
    expect(marketToday(lateUtc).toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });

  it('does not roll forward earlier in the UTC day', () => {
    const middayUtc = new Date('2026-09-10T12:00:00Z');
    expect(marketToday(middayUtc).toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('normalises to midnight, so the UTC getters below are exact', () => {
    const anchored = marketToday(new Date('2026-09-10T22:30:00Z'));
    expect(anchored.getUTCHours()).toBe(0);
    expect(anchored.getUTCMinutes()).toBe(0);
  });
});

describe('normalisePostcode', () => {
  it('accepts what buyers actually type', () => {
    expect(normalisePostcode('1205')).toBe('1205');
    expect(normalisePostcode('  1205  ')).toBe('1205');
    expect(normalisePostcode('E1 6AN')).toBe('E1 6AN');
    // Repeated inner spaces collapse rather than being rejected - a buyer who
    // double-spaced a UK postcode meant the same street.
    expect(normalisePostcode('E1   6AN')).toBe('E1 6AN');
  });

  it('refuses what cannot be a postcode', () => {
    expect(normalisePostcode('')).toBeNull();
    expect(normalisePostcode('12')).toBeNull();
    expect(normalisePostcode('1234567890123')).toBeNull();
    // Nothing that belongs in a query string rather than an address.
    expect(normalisePostcode('12/05')).toBeNull();
    expect(normalisePostcode('<script>')).toBeNull();
    expect(normalisePostcode(' 1205')).toBe('1205');
  });
});

describe('formatWindow', () => {
  it('gives dates, not a count of days', () => {
    // A buyer deciding whether to order before the weekend needs the day, and
    // counting forward from an unstated start is work the page can do.
    expect(formatWindow(SUN_13_SEP_2026, 1, 3)).toBe('Mon 14 – Wed 16 Sep');
  });

  it('states the month once when both ends share it', () => {
    expect(formatWindow(SUN_13_SEP_2026, 2, 5)).toBe('Tue 15 – Fri 18 Sep');
  });

  it('states both months when the range crosses one', () => {
    expect(formatWindow(SUN_13_SEP_2026, 15, 20)).toBe('Mon 28 Sep – Sat 3 Oct');
  });

  it('collapses to one date when the ends coincide', () => {
    // "Sat 14 - Sat 14 Sep" reads as a formatting bug rather than a precise
    // estimate.
    expect(formatWindow(SUN_13_SEP_2026, 2, 2)).toBe('Tue 15 Sep');
  });

  it('handles a same-day window', () => {
    expect(formatWindow(SUN_13_SEP_2026, 0, 0)).toBe('Sun 13 Sep');
  });

  it('crosses a year boundary without inventing a month', () => {
    const dec = new Date(Date.UTC(2026, 11, 28));
    expect(formatWindow(dec, 2, 6)).toBe('Wed 30 Dec – Sun 3 Jan');
  });
});

describe('toAnswer', () => {
  it('reports an unserviceable postcode as an answer, not an error', () => {
    const result: Serviceability = {
      serviceable: false,
      postcode: '5820',
      countryCode: 'BD',
    };
    expect(toAnswer(result, SUN_13_SEP_2026)).toEqual({
      kind: 'unserviceable',
      postcode: '5820',
    });
  });

  it('carries the area, the window and the rate', () => {
    const result: Serviceability = {
      serviceable: true,
      postcode: '1205',
      countryCode: 'BD',
      areaName: 'Dhanmondi, Dhaka',
      zoneName: 'Dhaka metro',
      codAllowed: true,
      earliestDays: 2,
      latestDays: 3,
      shipping: { amount: 6_000, currency: 'BDT' },
      overWeightLimit: false,
    };

    expect(toAnswer(result, SUN_13_SEP_2026)).toEqual({
      kind: 'serviceable',
      postcode: '1205',
      areaName: 'Dhanmondi, Dhaka',
      window: 'Tue 15 – Wed 16 Sep',
      shipping: { amount: 6_000, currency: 'BDT' },
      overWeightLimit: false,
      codAllowed: true,
    });
  });

  it('keeps the zone when the parcel is too heavy to quote', () => {
    // The zone is still the answer to "do you come here"; only the price is
    // missing, and the panel says which.
    const result: Serviceability = {
      serviceable: true,
      postcode: '1205',
      countryCode: 'BD',
      areaName: 'Dhanmondi, Dhaka',
      codAllowed: true,
      earliestDays: 1,
      latestDays: 2,
      shipping: null,
      overWeightLimit: true,
    };

    const answer = toAnswer(result, SUN_13_SEP_2026);
    expect(answer.kind).toBe('serviceable');
    if (answer.kind !== 'serviceable') throw new Error('unreachable');
    expect(answer.shipping).toBeNull();
    expect(answer.overWeightLimit).toBe(true);
    expect(answer.window).toBe('Mon 14 – Tue 15 Sep');
  });

  it('does not invent a rate when the server sent no optional fields', () => {
    // A serviceable answer with no weight supplied: zone and estimate, no
    // price. Defaulting to zero would render "Free delivery" for a parcel
    // nobody priced.
    const result: Serviceability = { serviceable: true, postcode: '1205', countryCode: 'BD' };
    const answer = toAnswer(result, SUN_13_SEP_2026);
    if (answer.kind !== 'serviceable') throw new Error('unreachable');
    expect(answer.shipping).toBeNull();
    expect(answer.codAllowed).toBe(false);
    expect(answer.areaName).toBe('your area');
  });
});
