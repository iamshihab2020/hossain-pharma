import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { withTenant } from '@nexmarket/db';
import { Public } from '../../common/decorators/public.decorator.js';
import { ServiceabilityService } from './serviceability.service.js';
import { SlotsService, type SlotView } from './slots.service.js';

export type SlotsResponse = {
  /** False when the postcode serves no zone; `slots` is then empty. */
  serviceable: boolean;
  /** Empty is legitimate: international zones have no scheduled windows. */
  slots: SlotView[];
};

/**
 * `GET /delivery-slots?postcode=` - PRD's logistics route list.
 *
 * @Public(), matching `/serviceability` next to it and for the same reason:
 * PRD 8.4 puts the delivery answer on the product page before add-to-cart, and
 * a window a buyer can be offered is part of that answer. Every table read is
 * platform-owned with no RLS, and a slot describes a courier's capacity in a
 * region - it names no person and belongs to no seller.
 *
 * It exposes REMAINING capacity, not `booked`, deliberately. "Four left this
 * morning" is useful to a buyer; how many other people ordered is not their
 * business and is a small competitive leak besides.
 */
@ApiTags('logistics')
@Controller()
export class SlotsController {
  constructor(
    private readonly slots: SlotsService,
    private readonly serviceability: ServiceabilityService,
  ) {}

  @Public()
  @Get('delivery-slots')
  async list(
    @Query('postcode') postcode?: string,
    @Query('country') country?: string,
    @Query('from') from?: string,
  ): Promise<SlotsResponse> {
    const trimmed = (postcode ?? '').trim();
    if (trimmed === '') throw new BadRequestException('Enter a postcode');
    if (trimmed.length > 12) throw new BadRequestException('That is not a postcode');

    const countryCode = (country ?? 'BD').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      throw new BadRequestException('Country must be a two-letter code');
    }

    /**
     * `from` is validated as a DATE STRING and used as one.
     *
     * It reaches a `>=` comparison against a `date` column, so a malformed
     * value would raise inside the query and turn a caller typo into a 500 -
     * the same failure mode the tenant header's UUID check exists to prevent.
     */
    const start = (from ?? today()).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      throw new BadRequestException('from must be a YYYY-MM-DD date');
    }

    return withTenant({ tenantId: null, userId: null, isAdmin: false }, async (tx) => {
      const zone = await this.serviceability.resolve(tx, trimmed, countryCode);
      if (zone === null) return { serviceable: false, slots: [] };
      return { serviceable: true, slots: await this.slots.available(tx, zone.id, start) };
    });
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
