import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireCapability } from '../../common/decorators/capabilities.decorator.js';
import type { OrderView } from '../orders/orders.service.js';
import { parseReject } from './dto.js';
import { FulfilmentService } from './fulfilment.service.js';

/**
 * The seller's fulfilment verbs.
 *
 * `order:write` rather than a role name (ADR 0013). Note what it is NOT: the
 * suspension withdrawal set is `product:write`, `settings:write`, `payout:write`
 * and `member:write`, and `order:write` is deliberately absent - PRD 6.6
 * requires a suspended seller to keep fulfilling orders they have already taken
 * money for.
 *
 * Every route is a VERB. Nothing here accepts a status to set: the status is a
 * consequence of what the verb did, computed from line coverage, and an
 * endpoint that took one would be a way to make the column disagree with the
 * parcels underneath it.
 */
@ApiTags('fulfilment')
@Controller('seller/orders/:id')
export class SellerFulfilmentController {
  constructor(private readonly fulfilment: FulfilmentService) {}

  @Post('accept')
  @HttpCode(200)
  @RequireCapability('order:write')
  async accept(@Param('id') id: string): Promise<OrderView> {
    return this.fulfilment.accept(id);
  }

  @Post('reject')
  @HttpCode(200)
  @RequireCapability('order:write')
  async reject(@Param('id') id: string, @Body() body: unknown): Promise<OrderView> {
    return this.fulfilment.reject(id, parseReject(body).reason);
  }
}
