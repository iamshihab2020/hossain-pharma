import type { DeliverySlot } from '@nexmarket/api-client';

/**
 * The delivery-window picker's view logic, as plain functions.
 *
 * Same convention as `delivery.ts`: the decisions live here so they can be
 * tested in the node environment, and the component keeps only markup.
 */

export type SlotDay = {
  /** `YYYY-MM-DD`, the key the API and the booking both use. */
  date: string;
  /** "Sat 13 Sep" - what the column header says. */
  label: string;
  /** "Today" / "Tomorrow" when that is truer than a date. */
  relative: string | null;
  windows: SlotWindow[];
};

export type SlotWindow = {
  id: string;
  /** "9:00 am – 1:00 pm". */
  label: string;
  remaining: number;
  /** True when this is the last handful, which is worth saying out loud. */
  scarce: boolean;
};

/** Below this, the picker says how many are left rather than just offering it. */
export const SCARCE_THRESHOLD = 5;

/**
 * Groups flat slots into days, preserving the API's order.
 *
 * The API already sorts by (date, start) and already drops full windows, so
 * this neither sorts nor filters - doing either here would be a second opinion
 * about capacity, formed from data that is by then a moment old.
 */
export function groupByDay(slots: readonly DeliverySlot[], today: Date): SlotDay[] {
  const days = new Map<string, SlotDay>();

  for (const slot of slots) {
    const existing = days.get(slot.date);
    const window: SlotWindow = {
      id: slot.id,
      label: `${formatMinute(slot.startMinute)} – ${formatMinute(slot.endMinute)}`,
      remaining: slot.remaining,
      scarce: slot.remaining <= SCARCE_THRESHOLD,
    };

    if (existing === undefined) {
      days.set(slot.date, {
        date: slot.date,
        label: formatDate(slot.date),
        relative: relativeTo(slot.date, today),
        windows: [window],
      });
    } else {
      existing.windows.push(window);
    }
  }

  return [...days.values()];
}

/**
 * "9:00 am", from minutes past midnight.
 *
 * Twelve-hour with am/pm because that is how delivery windows are spoken about
 * in this market, and the picker is read by buyers rather than operators. The
 * seller console uses the same helper and the same clock - one vocabulary.
 */
export function formatMinute(minute: number): string {
  const hour24 = Math.floor(minute / 60);
  const minutes = minute % 60;
  const suffix = hour24 < 12 ? 'am' : 'pm';
  // 0 -> 12am, 12 -> 12pm, 13 -> 1pm.
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${String(hour12)}:${minutes.toString().padStart(2, '0')} ${suffix}`;
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

/** "Sat 13 Sep" from a `YYYY-MM-DD` string. */
export function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${WEEKDAYS[parsed.getUTCDay()] ?? ''} ${String(parsed.getUTCDate())} ${
    MONTHS[parsed.getUTCMonth()] ?? ''
  }`;
}

/**
 * "Today" or "Tomorrow", or null for anything further out.
 *
 * Only two, deliberately. "In 3 days" is arithmetic a reader has to redo
 * against their own calendar, whereas "Sat 13 Sep" is a date they can act on -
 * so past tomorrow the date alone is more useful than a relative phrase.
 */
export function relativeTo(date: string, today: Date): string | null {
  const target = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;

  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((target.getTime() - midnight) / 86_400_000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return null;
}
