import type { Serviceability } from '@nexmarket/api-client';

/**
 * The delivery check, as plain functions over plain values.
 *
 * Everything a person reads on the delivery panel is decided here rather than
 * in the component, which is the front-end convention Phase 5 settled: server
 * components cannot be driven by a DOM testing library, so anything worth
 * asserting is pushed into functions like these and the component keeps only
 * markup. See `lib/order-timeline.test.ts` for the reasoning.
 */

/**
 * The marketplace's calendar timezone.
 *
 * Delivery dates are a promise about a DAY, and which day it is depends on
 * where the courier is, not where the server is. This marketplace delivers in
 * Bangladesh, so its calendar is Dhaka's.
 */
export const MARKET_TIME_ZONE = 'Asia/Dhaka';

/**
 * Today, in the market's calendar, as a Date whose UTC fields hold that date.
 *
 * The mismatch this exists to stop: `new Date()` is the server's LOCAL instant,
 * and every formatter below reads it with `getUTC*`. At 04:30 in Dhaka it is
 * still the previous day in UTC, so a plain `new Date()` shifted every estimate
 * one day early - visible only between midnight and 06:00 local, which is
 * exactly when nobody looks. Normalising to a UTC-midnight anchor makes the UTC
 * getters correct by construction rather than by luck.
 */
export function marketToday(now: Date = new Date()): Date {
  // `en-CA` formats as YYYY-MM-DD, which parses back as a UTC midnight.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${parts}T00:00:00Z`);
}

/**
 * A postcode as the API wants it, or null when it is not worth asking.
 *
 * Validated HERE as well as on the server, and the two are not redundant: this
 * one exists to avoid a round trip that can only fail, the server's exists
 * because a request body is not a form. Neither is the other's backup.
 */
export function normalisePostcode(raw: string): string | null {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 3 || trimmed.length > 12) return null;
  // Letters, digits and single spaces: enough for BD's four digits and the UK's
  // "E1 6AN", and not enough for anything that belongs in a query string.
  if (!/^[A-Za-z0-9][A-Za-z0-9 ]*$/.test(trimmed)) return null;
  return trimmed;
}

export type DeliveryAnswer =
  | { kind: 'unserviceable'; postcode: string }
  | {
      kind: 'serviceable';
      postcode: string;
      areaName: string;
      /** "Sat 14 - Mon 16 Sep", or "Sat 14 Sep" when the range is one day. */
      window: string;
      /** Null when no weight was known, or when the parcel is over the ceiling. */
      shipping: { amount: number; currency: string } | null;
      overWeightLimit: boolean;
      codAllowed: boolean;
    };

/**
 * Turns the API's answer into the one sentence the panel renders.
 *
 * `today` is a parameter rather than `new Date()` so the formatting is testable
 * without freezing the clock, and so a page rendered on the server and hydrated
 * on the client cannot disagree about what day it is - which is a real
 * hydration mismatch and not a hypothetical one.
 */
export function toAnswer(result: Serviceability, today: Date): DeliveryAnswer {
  if (!result.serviceable) {
    return { kind: 'unserviceable', postcode: result.postcode };
  }

  return {
    kind: 'serviceable',
    postcode: result.postcode,
    areaName: result.areaName ?? 'your area',
    window: formatWindow(today, result.earliestDays ?? 0, result.latestDays ?? 0),
    shipping: result.shipping ?? null,
    overWeightLimit: result.overWeightLimit ?? false,
    codAllowed: result.codAllowed ?? false,
  };
}

/**
 * A date range a person can act on: "Sat 14 - Mon 16 Sep".
 *
 * DATES, not "3-5 days". A buyer deciding whether to order before a weekend
 * needs to know which day, and counting forward from an unstated start is work
 * the page can do for them. The month appears once when both ends share it,
 * which is how a person would write it.
 *
 * The range collapses to a single date when the ends coincide, because "Sat 14
 * - Sat 14 Sep" reads as a formatting bug.
 */
export function formatWindow(today: Date, earliestDays: number, latestDays: number): string {
  const earliest = addDays(today, earliestDays);
  const latest = addDays(today, latestDays);

  if (sameDay(earliest, latest)) return formatFull(latest);
  if (
    earliest.getUTCMonth() === latest.getUTCMonth() &&
    earliest.getUTCFullYear() === latest.getUTCFullYear()
  ) {
    return `${formatShort(earliest)} – ${formatFull(latest)}`;
  }
  return `${formatFull(earliest)} – ${formatFull(latest)}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "Sat 14" - the near end of a range whose month the far end states. */
function formatShort(date: Date): string {
  return `${WEEKDAYS[date.getUTCDay()] ?? ''} ${String(date.getUTCDate())}`;
}

/** "Mon 16 Sep". */
function formatFull(date: Date): string {
  return `${formatShort(date)} ${MONTHS[date.getUTCMonth()] ?? ''}`;
}

function addDays(from: Date, days: number): Date {
  return new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + days),
  );
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
