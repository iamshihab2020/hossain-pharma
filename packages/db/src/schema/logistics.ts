import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Phase 6 geography. ALL FOUR TABLES ARE PLATFORM-OWNED, and that is a decision
 * rather than an omission - the same one `categories` and `products` got in
 * Phase 2, for the same reason.
 *
 * The product page runs with NO tenant context. PRD 8.4 puts a serviceability
 * check and a delivery estimate on it *before* add-to-cart, for an anonymous
 * visitor who has not chosen a seller yet, so the pincode lookup and the rate
 * that follows from it have to be readable with no `app.tenant_id` set. A
 * tenant-owned zone table would return zero rows to exactly the reader that
 * needs it.
 *
 * There is a stronger reason for the RATES specifically. The buy box ranks
 * competing offers on LANDED price (`buy-box.ts`), so it has to add shipping to
 * every seller's sticker price in one pass. Per-seller rate cards would make
 * that ranking unresolvable for a signed-out buyer: N sellers means N tenant
 * contexts, and the page has none. A platform rate card per (zone, weight band)
 * keeps landed price computable from public rows. Seller-funded shipping
 * promotions are Phase 9 and ride on top as a discount, not as a second rate
 * card.
 *
 * `warehouses` stays TENANT-owned and is extended in place, as its own comment
 * promised in Phase 2.
 */

/**
 * A delivery region: Dhaka metro, the rest of Dhaka division, outside-city, and
 * a few international ones (PRD Q4 resolves to Bangladesh districts plus three).
 *
 * `codAllowed` is a property of GEOGRAPHY, not of the seller or the buyer. PRD
 * 9.1 says payment method selection offers "COD where the zone allows it", and
 * a courier that will not collect cash in a zone is the reason the option
 * disappears. Checkout reads this column, which is why it lives here rather
 * than as a flag on the payment adapter.
 */
export const deliveryZones = pgTable(
  'delivery_zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable and human-readable, because rate cards are edited by people. */
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    countryCode: char('country_code', { length: 2 }).notNull(),

    codAllowed: boolean('cod_allowed').notNull().default(true),

    /**
     * The estimate the product page renders, as a RANGE. A single number reads
     * as a promise, and PRD 8.4's own wording is "delivery estimate" - an
     * estimate presented as a quote is the thing buyers never forgive.
     *
     * Transit only. The seller's own `dispatch_days` is added on top at quote
     * time, because how fast a box leaves the warehouse is the seller's
     * performance and how fast it crosses the country is the zone's.
     */
    transitDaysMin: integer('transit_days_min').notNull(),
    transitDaysMax: integer('transit_days_max').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('delivery_zones_transit_ordered', sql`${t.transitDaysMin} <= ${t.transitDaysMax}`),
    check('delivery_zones_transit_positive', sql`${t.transitDaysMin} >= 0`),
    index('delivery_zones_country_idx').on(t.countryCode),
  ],
);

/**
 * The pincode lookup: which zone serves this postcode.
 *
 * A ROW MISSING IS THE ANSWER "we do not deliver there", and that is why this
 * is a table rather than a range expression or a prefix rule. PRD 8.4 wants the
 * negative answer on the product page as a first-class outcome, and a rule that
 * computes a zone for every input can never produce one.
 *
 * Keyed on (country, postcode) rather than postcode alone: postcodes are not
 * globally unique, and "1205" is a Dhaka thoroughfare and a Swiss village.
 */
export const serviceability = pgTable(
  'serviceability',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryCode: char('country_code', { length: 2 }).notNull(),
    postcode: text('postcode').notNull(),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => deliveryZones.id, { onDelete: 'cascade' }),
    /** Human-facing, so the page can say "Delivers to Dhanmondi, Dhaka". */
    areaName: text('area_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('serviceability_country_postcode_key').on(t.countryCode, t.postcode),
    index('serviceability_zone_idx').on(t.zoneId),
  ],
);

/**
 * One weight band of one zone's rate card.
 *
 * `maxWeightGrams` is the band's INCLUSIVE upper bound and the row is chosen by
 * `min(max_weight_grams) WHERE max_weight_grams >= chargeable`. Bands rather
 * than a per-gram rate because that is how couriers actually price, and because
 * a continuous function hides the cliff a seller needs to see when a 501 g
 * parcel costs what a 1 kg one does.
 *
 * The heaviest band is the ceiling: a parcel over it is not quotable, which is
 * a real answer ("this needs freight") rather than an extrapolation.
 *
 * CHARGEABLE weight, not actual - `max(actual, volumetric)`. A duvet weighs
 * nothing and fills a van. `dimensionalWeight()` in @nexmarket/shared owns that
 * arithmetic and the divisor it uses.
 */
export const zoneRates = pgTable(
  'zone_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => deliveryZones.id, { onDelete: 'cascade' }),
    maxWeightGrams: integer('max_weight_grams').notNull(),

    /** Integer minor units, like every other amount in this schema. */
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('zone_rates_weight_positive', sql`${t.maxWeightGrams} > 0`),
    check('zone_rates_amount_non_negative', sql`${t.amountMinor} >= 0`),
    unique('zone_rates_zone_band_key').on(t.zoneId, t.maxWeightGrams),
    index('zone_rates_zone_idx').on(t.zoneId),
  ],
);

/**
 * Delivery capacity for one zone on one day.
 *
 * `booked` is a COUNTER on the slot rather than a count over orders, and it is
 * incremented with the predicate repeated outside the subquery - the same shape
 * the Phase 4 stock reservation needed after two checkouts took the last unit
 * (ADR 0018). A slot is the same race with a smaller number.
 *
 * Minutes from midnight rather than a time column: the slot is a LABEL on a
 * date in the zone's own reckoning, and a timestamptz would invite a timezone
 * conversion that turns "Saturday morning" into Friday night for a reader
 * elsewhere.
 */
export const deliverySlots = pgTable(
  'delivery_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => deliveryZones.id, { onDelete: 'cascade' }),
    slotDate: date('slot_date').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),

    capacity: integer('capacity').notNull(),
    booked: integer('booked').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'delivery_slots_window_ordered',
      sql`${t.startMinute} >= 0 AND ${t.startMinute} < ${t.endMinute} AND ${t.endMinute} <= 1440`,
    ),
    check('delivery_slots_capacity_positive', sql`${t.capacity} > 0`),
    /**
     * Overbooking is unrepresentable, not merely rejected by the service. The
     * service's conditional UPDATE is the fast path; this is what holds if a
     * future caller writes the counter by hand.
     */
    check(
      'delivery_slots_booked_within_capacity',
      sql`${t.booked} >= 0 AND ${t.booked} <= ${t.capacity}`,
    ),
    unique('delivery_slots_zone_date_start_key').on(t.zoneId, t.slotDate, t.startMinute),
    /** The picker's driving query: every slot for one zone from today forward. */
    index('delivery_slots_zone_date_idx').on(t.zoneId, t.slotDate),
  ],
);
