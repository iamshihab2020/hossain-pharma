import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { withTenant } from '@nexmarket/db';
import { deliveryWindow, rateFor } from '@nexmarket/shared';
import { Public } from '../../common/decorators/public.decorator.js';
import { ServiceabilityService } from './serviceability.service.js';

/**
 * Serviceability as PRD 8.4 puts it on the product page: "delivery estimate by
 * pincode with serviceability check BEFORE adding to cart".
 *
 * @Public(), and it has to be. The whole point is that a visitor who has not
 * signed in, has no address book and has not chosen a seller can ask "do you
 * come to my street?" and get an answer. Every table it reads is
 * platform-owned and carries no RLS, so the query works with no tenant context
 * rather than returning zero rows.
 *
 * It opens its own `withTenant` rather than taking one from the request
 * context, because @Public() routes skip the interceptor entirely - the same
 * pattern CatalogueService uses.
 */
@ApiTags('logistics')
@Controller()
export class ServiceabilityController {
  constructor(private readonly serviceability: ServiceabilityService) {}

  @Public()
  @Get('serviceability')
  async check(
    @Query('postcode') postcode?: string,
    @Query('country') country?: string,
    @Query('weightGrams') weightGrams?: string,
    @Query('dispatchDays') dispatchDays?: string,
  ): Promise<ServiceabilityView> {
    const trimmed = (postcode ?? '').trim();
    if (trimmed === '') throw new BadRequestException('Enter a postcode');
    if (trimmed.length > 12) throw new BadRequestException('That is not a postcode');

    const countryCode = (country ?? 'BD').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      throw new BadRequestException('Country must be a two-letter code');
    }

    const zone = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      this.serviceability.resolve(tx, trimmed, countryCode),
    );

    /**
     * NOT SERVICEABLE IS A 200, not a 404.
     *
     * The question was answered: no courier covers that postcode. A 404 would
     * say the *endpoint* found nothing, and every client would have to tell the
     * two apart to render a sentence that is really about geography.
     */
    if (zone === null) {
      return { serviceable: false, postcode: trimmed, countryCode };
    }

    /**
     * The rate is quoted only when a weight is supplied, because a rate without
     * one is a guess. The product page knows the variant's weight; a bare
     * serviceability check from anywhere else gets the zone and the estimate
     * and no number, which is honest rather than empty.
     */
    const grams = parsePositiveInt(weightGrams);
    const rate = grams === null ? null : rateFor(zone.bands, grams);

    const dispatch = parseNonNegativeInt(dispatchDays) ?? 0;
    const window = deliveryWindow(dispatch, zone.transitDaysMin, zone.transitDaysMax);

    return {
      serviceable: true,
      postcode: trimmed,
      countryCode,
      areaName: zone.areaName,
      zoneName: zone.name,
      codAllowed: zone.codAllowed,
      earliestDays: window.earliestDays,
      latestDays: window.latestDays,
      shipping: rate,
      /**
       * TRUE when a weight was given but no band covers it. The page says "too
       * heavy for standard delivery" rather than showing a blank price, which
       * would read as a broken quote for a parcel that simply needs freight.
       */
      overWeightLimit: grams !== null && rate === null,
    };
  }
}

export type ServiceabilityView = {
  serviceable: boolean;
  postcode: string;
  countryCode: string;
  areaName?: string;
  zoneName?: string;
  codAllowed?: boolean;
  earliestDays?: number;
  latestDays?: number;
  shipping?: { amount: number; currency: string } | null;
  overWeightLimit?: boolean;
};

function parsePositiveInt(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseNonNegativeInt(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value >= 0 ? value : null;
}
