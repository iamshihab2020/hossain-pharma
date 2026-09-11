import { ConflictException, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { type Transaction, schema } from '@nexmarket/db';

export type SlotView = {
  id: string;
  /** `YYYY-MM-DD`, in the zone's own reckoning. */
  date: string;
  startMinute: number;
  endMinute: number;
  /** What is left, not what was booked. The picker disables on this. */
  remaining: number;
};

/**
 * Delivery slot capacity, per zone per day.
 *
 * PRD 9.1 asks for a "delivery slot per seller group", and Phase 6 deliberately
 * did NOT build it that way. A slot is a COURIER's capacity in a ZONE, not a
 * seller's, so a cart spanning three sellers books one window and the buyer
 * answers the question once. Three pickers on one checkout would be three
 * chances to choose three different mornings for parcels arriving at one door.
 */
@Injectable()
export class SlotsService {
  /**
   * The windows a buyer may still choose, from `from` forward.
   *
   * Empty is a legitimate answer, not an error: no international zone has
   * slots, because a scheduled window across a customs border is a promise
   * nobody can keep. Checkout renders "no scheduled windows on this route" and
   * places the order without one.
   */
  async available(
    tx: Transaction,
    zoneId: string,
    from: string,
    days = 14,
  ): Promise<SlotView[]> {
    const until = addDays(from, days);

    const rows = await tx
      .select({
        id: schema.deliverySlots.id,
        slotDate: schema.deliverySlots.slotDate,
        startMinute: schema.deliverySlots.startMinute,
        endMinute: schema.deliverySlots.endMinute,
        capacity: schema.deliverySlots.capacity,
        booked: schema.deliverySlots.booked,
      })
      .from(schema.deliverySlots)
      .where(
        and(
          eq(schema.deliverySlots.zoneId, zoneId),
          gte(schema.deliverySlots.slotDate, from),
          sql`${schema.deliverySlots.slotDate} < ${until}`,
        ),
      )
      .orderBy(asc(schema.deliverySlots.slotDate), asc(schema.deliverySlots.startMinute));

    return rows
      .map((row) => ({
        id: row.id,
        date: row.slotDate,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        remaining: row.capacity - row.booked,
      }))
      /**
       * FULL SLOTS ARE DROPPED, not returned disabled.
       *
       * A window a buyer cannot have is not an option, and rendering it greyed
       * out invites them to keep clicking it. The picker shows what is
       * available; if a day has nothing left the day is simply absent.
       */
      .filter((slot) => slot.remaining > 0);
  }

  /**
   * Takes one unit of a slot's capacity, or refuses.
   *
   * THE PREDICATE IS REPEATED OUTSIDE THE UPDATE, and both halves are
   * load-bearing. This is the same shape Phase 4's stock reservation needed
   * after two concurrent checkouts both took the last unit: an UPDATE whose
   * guard lives only in a subquery is evaluated against the pre-lock snapshot,
   * so two callers can both see spare capacity and both write. A single
   * conditional UPDATE with `booked < capacity` in its own WHERE is checked
   * after the row lock, so exactly one wins. ADR 0018.
   *
   * The `booked <= capacity` CHECK constraint on the table is the second line:
   * even a future caller who writes the counter by hand cannot overbook.
   */
  async book(tx: Transaction, slotId: string): Promise<void> {
    const updated = await tx
      .update(schema.deliverySlots)
      .set({ booked: sql`${schema.deliverySlots.booked} + 1` })
      .where(
        and(
          eq(schema.deliverySlots.id, slotId),
          sql`${schema.deliverySlots.booked} < ${schema.deliverySlots.capacity}`,
        ),
      )
      .returning({ id: schema.deliverySlots.id });

    if (updated.length === 0) {
      throw new ConflictException(
        'That delivery window just filled up. Choose another and try again.',
      );
    }
  }

  /**
   * Gives a slot back.
   *
   * `booked > 0` in the WHERE rather than a bare decrement: a release that ran
   * twice would push the counter negative and hand out capacity that does not
   * exist. The table's own check would catch it, but a 500 on a cancellation is
   * a worse experience than a no-op, and there is nothing to tell the buyer.
   */
  async release(tx: Transaction, slotId: string): Promise<void> {
    await tx
      .update(schema.deliverySlots)
      .set({ booked: sql`${schema.deliverySlots.booked} - 1` })
      .where(and(eq(schema.deliverySlots.id, slotId), sql`${schema.deliverySlots.booked} > 0`));
  }

  /** Confirms a slot belongs to the zone the address resolved to. */
  async belongsToZone(tx: Transaction, slotId: string, zoneId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: schema.deliverySlots.id })
      .from(schema.deliverySlots)
      .where(and(eq(schema.deliverySlots.id, slotId), eq(schema.deliverySlots.zoneId, zoneId)))
      .limit(1);
    return row !== undefined;
  }
}

/** `YYYY-MM-DD` arithmetic, in UTC, matching how the seed writes slot dates. */
function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
