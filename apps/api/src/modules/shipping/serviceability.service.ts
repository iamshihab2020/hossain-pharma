import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { type Transaction, schema } from '@nexmarket/db';
import { money } from '@nexmarket/shared';
import type { QuoteZone } from './shipping-quote.port.js';

/**
 * Postcode to zone, with the zone's rate card attached.
 *
 * ONE LOOKUP PER QUOTE, not one per seller group. The zone is a property of
 * where the buyer is, so a cart spanning three sellers resolves it once and
 * hands the same card to all three - which is what keeps the checkout path
 * inside PRD 13's p95 < 500 ms budget while the adapter stays a pure function.
 *
 * All four tables are PLATFORM-OWNED and carry no RLS, so this reads correctly
 * with no tenant context - which is the point. The product page's serviceability
 * check runs for an anonymous visitor who has chosen no seller.
 */
@Injectable()
export class ServiceabilityService {
  /**
   * `null` means NOT SERVICEABLE, and it is a real answer rather than a lookup
   * failure. PRD 8.4 puts that outcome on the product page as a first-class
   * case, which is why serviceability is a table of covered postcodes rather
   * than a rule that computes a zone for every input - a rule can never say no.
   */
  async resolve(
    tx: Transaction,
    postcode: string,
    countryCode: string,
  ): Promise<QuoteZone | null> {
    const normalisedPostcode = normalisePostcode(postcode);
    const normalisedCountry = countryCode.trim().toUpperCase();
    if (normalisedPostcode === '') return null;

    const [row] = await tx
      .select({
        zoneId: schema.deliveryZones.id,
        code: schema.deliveryZones.code,
        name: schema.deliveryZones.name,
        codAllowed: schema.deliveryZones.codAllowed,
        transitDaysMin: schema.deliveryZones.transitDaysMin,
        transitDaysMax: schema.deliveryZones.transitDaysMax,
        areaName: schema.serviceability.areaName,
      })
      .from(schema.serviceability)
      .innerJoin(
        schema.deliveryZones,
        eq(schema.deliveryZones.id, schema.serviceability.zoneId),
      )
      .where(
        and(
          eq(schema.serviceability.countryCode, normalisedCountry),
          eq(schema.serviceability.postcode, normalisedPostcode),
        ),
      )
      .limit(1);

    if (row === undefined) return null;

    const bands = await tx
      .select({
        maxWeightGrams: schema.zoneRates.maxWeightGrams,
        amountMinor: schema.zoneRates.amountMinor,
        currency: schema.zoneRates.currency,
      })
      .from(schema.zoneRates)
      .where(eq(schema.zoneRates.zoneId, row.zoneId))
      .orderBy(asc(schema.zoneRates.maxWeightGrams));

    return {
      id: row.zoneId,
      code: row.code,
      name: row.name,
      areaName: row.areaName,
      codAllowed: row.codAllowed,
      transitDaysMin: row.transitDaysMin,
      transitDaysMax: row.transitDaysMax,
      bands: bands.map((band) => ({
        maxWeightGrams: band.maxWeightGrams,
        amount: money(band.amountMinor, band.currency),
      })),
    };
  }
}

/**
 * Upper-cased and stripped of internal spaces.
 *
 * Bangladesh postcodes are four digits and need none of this; UK ones are
 * "E1 6AN" and arrive as "e1 6an", "E16AN" and "E1  6AN" from three buyers who
 * all mean the same place. The seed stores the canonical form and this makes
 * the lookup agree with it, because an exact-match table plus free text is a
 * "we don't deliver there" for an address the courier covers.
 */
function normalisePostcode(postcode: string): string {
  return postcode.replace(/\s+/g, '').trim().toUpperCase();
}
