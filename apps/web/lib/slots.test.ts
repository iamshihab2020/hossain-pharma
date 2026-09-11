import { describe, expect, it } from 'vitest';
import type { DeliverySlot } from '@nexmarket/api-client';
import { SCARCE_THRESHOLD, formatDate, formatMinute, groupByDay, relativeTo } from './slots';

const SUN_13_SEP_2026 = new Date(Date.UTC(2026, 8, 13));

function slot(overrides: Partial<DeliverySlot> = {}): DeliverySlot {
  return {
    id: 'slot-1',
    date: '2026-09-13',
    startMinute: 9 * 60,
    endMinute: 13 * 60,
    remaining: 40,
    ...overrides,
  };
}

describe('formatMinute', () => {
  it('reads as a delivery window, not a 24-hour clock', () => {
    expect(formatMinute(9 * 60)).toBe('9:00 am');
    expect(formatMinute(13 * 60)).toBe('1:00 pm');
    expect(formatMinute(15 * 60 + 30)).toBe('3:30 pm');
  });

  it('handles both ends of the day without a zero hour', () => {
    // 0 and 12 both map to 12 on a twelve-hour clock, in different halves.
    // Getting this wrong prints "0:00 am", which no courier has ever said.
    expect(formatMinute(0)).toBe('12:00 am');
    expect(formatMinute(12 * 60)).toBe('12:00 pm');
    expect(formatMinute(23 * 60 + 59)).toBe('11:59 pm');
  });
});

describe('formatDate', () => {
  it('gives a weekday a person can plan around', () => {
    expect(formatDate('2026-09-13')).toBe('Sun 13 Sep');
    expect(formatDate('2026-10-01')).toBe('Thu 1 Oct');
  });

  it('returns the input unchanged rather than rendering "Invalid Date"', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('relativeTo', () => {
  it('names only today and tomorrow', () => {
    expect(relativeTo('2026-09-13', SUN_13_SEP_2026)).toBe('Today');
    expect(relativeTo('2026-09-14', SUN_13_SEP_2026)).toBe('Tomorrow');
  });

  it('leaves anything further out to its date', () => {
    // "In 3 days" is arithmetic the reader has to redo against their own
    // calendar; a date is something they can act on.
    expect(relativeTo('2026-09-16', SUN_13_SEP_2026)).toBeNull();
  });

  it('does not label a past date', () => {
    expect(relativeTo('2026-09-12', SUN_13_SEP_2026)).toBeNull();
  });
});

describe('groupByDay', () => {
  it('collects windows under the day they belong to', () => {
    const days = groupByDay(
      [
        slot({ id: 'a', date: '2026-09-13', startMinute: 9 * 60, endMinute: 13 * 60 }),
        slot({ id: 'b', date: '2026-09-13', startMinute: 15 * 60, endMinute: 20 * 60 }),
        slot({ id: 'c', date: '2026-09-14', startMinute: 9 * 60, endMinute: 13 * 60 }),
      ],
      SUN_13_SEP_2026,
    );

    expect(days).toHaveLength(2);
    expect(days[0]?.windows.map((w) => w.id)).toEqual(['a', 'b']);
    expect(days[1]?.windows.map((w) => w.id)).toEqual(['c']);
    expect(days[0]?.relative).toBe('Today');
    expect(days[1]?.label).toBe('Mon 14 Sep');
  });

  it('preserves the order the API sent', () => {
    // The API already sorts by (date, start) and already drops full windows.
    // Re-sorting here would be a second opinion about capacity, formed from
    // data that is by then a moment old.
    const days = groupByDay(
      [
        slot({ id: 'late', date: '2026-09-14' }),
        slot({ id: 'early', date: '2026-09-13' }),
      ],
      SUN_13_SEP_2026,
    );
    expect(days.map((d) => d.date)).toEqual(['2026-09-14', '2026-09-13']);
  });

  it('flags a window that is nearly gone', () => {
    const days = groupByDay(
      [
        slot({ id: 'plenty', remaining: SCARCE_THRESHOLD + 1 }),
        slot({ id: 'scarce', remaining: SCARCE_THRESHOLD, startMinute: 15 * 60 }),
      ],
      SUN_13_SEP_2026,
    );

    expect(days[0]?.windows[0]?.scarce).toBe(false);
    expect(days[0]?.windows[1]?.scarce).toBe(true);
  });

  it('labels each window with its hours', () => {
    const days = groupByDay([slot()], SUN_13_SEP_2026);
    expect(days[0]?.windows[0]?.label).toBe('9:00 am – 1:00 pm');
  });

  it('handles no windows at all', () => {
    // An international route has none, and that is an answer rather than an
    // error. The picker renders a sentence instead of an empty grid.
    expect(groupByDay([], SUN_13_SEP_2026)).toEqual([]);
  });
});
