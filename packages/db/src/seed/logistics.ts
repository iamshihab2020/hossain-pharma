import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * PRD open question Q4, resolved with its own stated default: Bangladesh
 * districts plus three international zones.
 *
 * REAL POSTCODES. Every code below is a genuine Bangladesh Post Office number
 * and every area name is the place it serves - because a serviceability check
 * is the one screen where a buyer types something they know the answer to, and
 * an invented postcode that resolves is worse than an unrecognised real one.
 *
 * Four domestic tiers rather than 64 districts, because the thing being
 * modelled is COST, and the courier's own pricing has four tiers: inside the
 * metro, the rest of the division, the other divisional cities, and everywhere
 * else. Adding districts adds rows, not behaviour.
 */
const ZONES = [
  {
    code: 'BD-DHAKA-METRO',
    name: 'Dhaka metro',
    countryCode: 'BD',
    codAllowed: true,
    transitDaysMin: 1,
    transitDaysMax: 2,
  },
  {
    code: 'BD-DHAKA-DIV',
    name: 'Dhaka division',
    countryCode: 'BD',
    codAllowed: true,
    transitDaysMin: 2,
    transitDaysMax: 3,
  },
  {
    code: 'BD-METRO',
    name: 'Divisional cities',
    countryCode: 'BD',
    codAllowed: true,
    transitDaysMin: 2,
    transitDaysMax: 4,
  },
  {
    /**
     * COD IS OFF HERE, and that is the point of the column.
     *
     * The remote tier is the one where a courier will deliver but will not
     * carry cash back, so checkout has to withdraw the option. With every zone
     * COD-enabled the flag would be decoration and the checkout branch that
     * reads it would never run outside a test.
     */
    code: 'BD-REMOTE',
    name: 'Outside city',
    countryCode: 'BD',
    codAllowed: false,
    transitDaysMin: 4,
    transitDaysMax: 7,
  },
  {
    code: 'IN-NORTH',
    name: 'Northern India',
    countryCode: 'IN',
    codAllowed: false,
    transitDaysMin: 6,
    transitDaysMax: 10,
  },
  {
    code: 'AE-DUBAI',
    name: 'Dubai',
    countryCode: 'AE',
    codAllowed: false,
    transitDaysMin: 5,
    transitDaysMax: 8,
  },
  {
    code: 'GB-LONDON',
    name: 'Greater London',
    countryCode: 'GB',
    codAllowed: false,
    transitDaysMin: 7,
    transitDaysMax: 12,
  },
] as const;

/**
 * The pincode lookup.
 *
 * Deliberately NOT exhaustive: Bangladesh has some 700 postcodes and this seeds
 * about twenty. The gaps are the feature - a buyer who types 5820 (Panchagarh,
 * real and unseeded) gets the unserviceable answer, which is the branch PRD 8.4
 * asks the product page to render and the one that has no other way to be
 * demonstrated.
 */
const SERVICEABILITY = [
  // Dhaka metro
  { postcode: '1205', areaName: 'Dhanmondi, Dhaka', zone: 'BD-DHAKA-METRO' },
  { postcode: '1207', areaName: 'Mohammadpur, Dhaka', zone: 'BD-DHAKA-METRO' },
  { postcode: '1212', areaName: 'Gulshan, Dhaka', zone: 'BD-DHAKA-METRO' },
  { postcode: '1213', areaName: 'Banani, Dhaka', zone: 'BD-DHAKA-METRO' },
  { postcode: '1216', areaName: 'Mirpur, Dhaka', zone: 'BD-DHAKA-METRO' },
  { postcode: '1219', areaName: 'Khilgaon, Dhaka', zone: 'BD-DHAKA-METRO' },
  { postcode: '1229', areaName: 'Bashundhara, Dhaka', zone: 'BD-DHAKA-METRO' },
  // Dhaka division, outside the metro
  { postcode: '1340', areaName: 'Savar, Dhaka', zone: 'BD-DHAKA-DIV' },
  { postcode: '1700', areaName: 'Gazipur', zone: 'BD-DHAKA-DIV' },
  { postcode: '1400', areaName: 'Narayanganj', zone: 'BD-DHAKA-DIV' },
  { postcode: '1800', areaName: 'Tangail', zone: 'BD-DHAKA-DIV' },
  // Other divisional cities
  { postcode: '4000', areaName: 'Chattogram', zone: 'BD-METRO' },
  { postcode: '3100', areaName: 'Sylhet', zone: 'BD-METRO' },
  { postcode: '6000', areaName: 'Rajshahi', zone: 'BD-METRO' },
  { postcode: '9100', areaName: 'Khulna', zone: 'BD-METRO' },
  { postcode: '8200', areaName: 'Barishal', zone: 'BD-METRO' },
  { postcode: '2200', areaName: 'Mymensingh', zone: 'BD-METRO' },
  // Remote: delivered, but no cash collected
  { postcode: '5400', areaName: 'Dinajpur', zone: 'BD-REMOTE' },
  { postcode: '7400', areaName: 'Kushtia', zone: 'BD-REMOTE' },
  { postcode: '4700', areaName: "Cox's Bazar", zone: 'BD-REMOTE' },
  // International
  { postcode: '110001', areaName: 'New Delhi', zone: 'IN-NORTH' },
  { postcode: '00000', areaName: 'Dubai', zone: 'AE-DUBAI' },
  // Stored in the NORMALISED form the lookup uses - spaces stripped, upper
  // case - because buyers type "E1 6AN", "e16an" and "E1  6AN" for one place.
  { postcode: 'E16AN', areaName: 'Whitechapel, London', zone: 'GB-LONDON' },
] as const;

/**
 * Rate cards, in BDT minor units (paisa), by chargeable-weight band.
 *
 * Shaped like a real courier's: the first band carries most of the fixed cost
 * of touching a parcel at all, and each step up adds less than the one before.
 * A linear per-gram rate would price a 5 kg parcel at ten times a 500 g one,
 * which no courier charges and which would make heavy categories unsellable.
 *
 * The heaviest band is 20 kg everywhere. Above it `rateFor` returns null and
 * the quote falls back rather than extrapolating - a parcel over 20 kg needs
 * freight, and that is a real answer.
 *
 * International cards stay in BDT because the buyer pays in BDT; converting at
 * quote time would put a floating-point rate in a money path.
 */
const BANDS_BY_ZONE: Record<string, readonly (readonly [number, number])[]> = {
  // [maxWeightGrams, amountMinor]
  'BD-DHAKA-METRO': [
    [500, 6_000],
    [1_000, 8_000],
    [3_000, 12_000],
    [5_000, 16_000],
    [10_000, 26_000],
    [20_000, 44_000],
  ],
  'BD-DHAKA-DIV': [
    [500, 8_000],
    [1_000, 11_000],
    [3_000, 16_000],
    [5_000, 21_000],
    [10_000, 34_000],
    [20_000, 58_000],
  ],
  'BD-METRO': [
    [500, 11_000],
    [1_000, 14_000],
    [3_000, 21_000],
    [5_000, 28_000],
    [10_000, 45_000],
    [20_000, 76_000],
  ],
  'BD-REMOTE': [
    [500, 14_000],
    [1_000, 18_000],
    [3_000, 27_000],
    [5_000, 36_000],
    [10_000, 58_000],
    [20_000, 98_000],
  ],
  'IN-NORTH': [
    [500, 95_000],
    [1_000, 130_000],
    [3_000, 240_000],
    [5_000, 350_000],
    [10_000, 610_000],
  ],
  'AE-DUBAI': [
    [500, 120_000],
    [1_000, 165_000],
    [3_000, 310_000],
    [5_000, 450_000],
    [10_000, 790_000],
  ],
  'GB-LONDON': [
    [500, 160_000],
    [1_000, 220_000],
    [3_000, 420_000],
    [5_000, 610_000],
    [10_000, 1_080_000],
  ],
};

/**
 * Fourteen days of capacity per domestic zone, two windows a day.
 *
 * Slots are seeded FORWARD FROM TODAY rather than from a fixed date, so a
 * checkout run months after this seed still has windows to offer. A fixed
 * calendar would make the picker empty and the failure would read as a bug in
 * the picker.
 *
 * International zones get no slots on purpose: a scheduled window across a
 * customs border is a promise nobody can keep, and checkout renders "no
 * scheduled windows on this route" for them - a case the picker has to handle
 * anyway and now has data for.
 */
const SLOT_WINDOWS = [
  { startMinute: 9 * 60, endMinute: 13 * 60 },
  { startMinute: 15 * 60, endMinute: 20 * 60 },
] as const;

const SLOT_DAYS = 14;
const SLOT_CAPACITY = 40;

export type LogisticsSummary = {
  deliveryZones: number;
  serviceablePostcodes: number;
  zoneRates: number;
  deliverySlots: number;
};

export async function seedLogistics(db: Db): Promise<LogisticsSummary> {
  await db
    .insert(schema.deliveryZones)
    .values([...ZONES])
    .onConflictDoNothing();

  // Read the ids back rather than minting them here. onConflictDoNothing means
  // a re-run inserts nothing, so the ids that matter are whatever is already in
  // the table - generating them locally would attach every child row to a zone
  // that only exists on the first run.
  const zones = await db.select().from(schema.deliveryZones);
  const idByCode = new Map(zones.map((zone) => [zone.code, zone.id]));

  const serviceRows = SERVICEABILITY.flatMap((row) => {
    const zoneId = idByCode.get(row.zone);
    if (zoneId === undefined) return [];
    const zone = ZONES.find((z) => z.code === row.zone);
    return [
      {
        countryCode: zone?.countryCode ?? 'BD',
        postcode: row.postcode,
        areaName: row.areaName,
        zoneId,
      },
    ];
  });
  await db.insert(schema.serviceability).values(serviceRows).onConflictDoNothing();

  const rateRows = Object.entries(BANDS_BY_ZONE).flatMap(([code, bands]) => {
    const zoneId = idByCode.get(code);
    if (zoneId === undefined) return [];
    return bands.map(([maxWeightGrams, amountMinor]) => ({
      zoneId,
      maxWeightGrams,
      amountMinor,
      currency: 'BDT',
    }));
  });
  await db.insert(schema.zoneRates).values(rateRows).onConflictDoNothing();

  const slotRows = zones
    .filter((zone) => zone.countryCode === 'BD')
    .flatMap((zone) =>
      forwardDates(SLOT_DAYS).flatMap((slotDate) =>
        SLOT_WINDOWS.map((window) => ({
          zoneId: zone.id,
          slotDate,
          startMinute: window.startMinute,
          endMinute: window.endMinute,
          capacity: SLOT_CAPACITY,
        })),
      ),
    );
  await db.insert(schema.deliverySlots).values(slotRows).onConflictDoNothing();

  return {
    deliveryZones: ZONES.length,
    serviceablePostcodes: serviceRows.length,
    zoneRates: rateRows.length,
    deliverySlots: slotRows.length,
  };
}

/**
 * `YYYY-MM-DD` strings from tomorrow, in UTC.
 *
 * Tomorrow rather than today because every seeded listing has at least one
 * dispatch day, so a slot today is a window nothing can reach.
 */
function forwardDates(days: number): string[] {
  const dates: string[] = [];
  const start = new Date();
  for (let offset = 1; offset <= days; offset += 1) {
    const day = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + offset),
    );
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Shipping measurements for the seeded catalogue.
 *
 * Keyed on CATEGORY SLUG, because the category IS the taxonomy that decides
 * what a box looks like. The first version matched on SKU and variant name and
 * every one of the fourteen seeded variants fell through to the default -
 * variant names here are "128GB / Violet" and SKUs are "AUR-X1-128-VIO", so
 * nothing said what the thing was. Fourteen identical parcels would have made
 * the rate card produce one number for the whole catalogue and left the
 * volumetric branch untested against real data, which is most of why weights
 * were added at all.
 *
 * The mango and the tote are the entries that earn dimensions: light for their
 * size, so volumetric weight wins and the quote lands several bands above what
 * the scale says.
 */
const MEASUREMENTS: Record<
  string,
  { weightGrams: number; lengthMm: number; widthMm: number; heightMm: number }
> = {
  // Dense for their size: actual weight wins.
  smartphones: { weightGrams: 420, lengthMm: 170, widthMm: 90, heightMm: 45 },
  phones: { weightGrams: 420, lengthMm: 170, widthMm: 90, heightMm: 45 },
  electronics: { weightGrams: 1_200, lengthMm: 300, widthMm: 220, heightMm: 90 },
  // Over-ear headphones in a retail box: 3.6 kg volumetric on 300 g of goods.
  headphones: { weightGrams: 300, lengthMm: 240, widthMm: 210, heightMm: 90 },
  audio: { weightGrams: 300, lengthMm: 240, widthMm: 210, heightMm: 90 },
  // Folded cotton, compressible but bulky.
  clothing: { weightGrams: 450, lengthMm: 320, widthMm: 250, heightMm: 70 },
  fashion: { weightGrams: 450, lengthMm: 320, widthMm: 250, heightMm: 70 },
  // A 5 kg crate of mangoes: heavy AND bulky, and the only seeded thing that
  // reaches the upper bands.
  'fresh-produce': { weightGrams: 5_400, lengthMm: 400, widthMm: 300, heightMm: 250 },
  groceries: { weightGrams: 900, lengthMm: 220, widthMm: 160, heightMm: 120 },
  beverages: { weightGrams: 620, lengthMm: 150, widthMm: 110, heightMm: 190 },
  // Glass, boxed and padded, so the box is much larger than the bottle.
  spirits: { weightGrams: 1_450, lengthMm: 320, widthMm: 130, heightMm: 130 },
};

/** Anything unmatched: a mid-sized parcel, so no variant is unquotable. */
const DEFAULT_MEASUREMENT = {
  weightGrams: 800,
  lengthMm: 250,
  widthMm: 200,
  heightMm: 120,
} as const;

/**
 * Backfills the seeded catalogue so every variant is quotable.
 *
 * Runs as part of the seed rather than as a migration: a migration that invents
 * weights would put fiction in the schema history, whereas seed data is
 * understood to be fiction. Real catalogues get theirs from the seller at
 * listing time.
 */
export async function seedVariantMeasurements(db: Db): Promise<{ measuredVariants: number }> {
  const variants = await db
    .select({
      id: schema.productVariants.id,
      categorySlug: schema.categories.slug,
    })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .innerJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId));

  let measured = 0;
  for (const variant of variants) {
    const measurement = MEASUREMENTS[variant.categorySlug] ?? DEFAULT_MEASUREMENT;

    await db
      .update(schema.productVariants)
      .set({
        weightGrams: measurement.weightGrams,
        lengthMm: measurement.lengthMm,
        widthMm: measurement.widthMm,
        heightMm: measurement.heightMm,
      })
      .where(eq(schema.productVariants.id, variant.id));
    measured += 1;
  }

  return { measuredVariants: measured };
}
