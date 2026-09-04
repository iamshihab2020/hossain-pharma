import { BadRequestException, Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { RequireCapability } from '../../common/decorators/capabilities.decorator.js';
import { parseLimit, type Page } from '../../common/pagination.js';
import { OrdersService, type OrderView } from './orders.service.js';

/**
 * The buyer's order history: their orders across EVERY seller, in one call.
 *
 * Sends no tenant, so `own_orders` is the policy that applies. That is the
 * whole reason the policy exists - PRD 6.2's asymmetry, that a buyer belongs to
 * the platform rather than to any one seller, expressed in SQL.
 */
@ApiTags('orders')
@Controller('me/orders')
export class BuyerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  async list(
    @Req() req: FastifyRequest,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<Page<OrderView>> {
    return this.orders.forBuyer(this.userId(req), parseLimit(limit), cursor);
  }

  @Get(':id')
  async get(@Req() req: FastifyRequest, @Param('id') id: string): Promise<OrderView> {
    return this.orders.forBuyerOne(this.userId(req), id);
  }

  private userId(req: FastifyRequest): string {
    const sub = req.nexmarketUser?.sub;
    if (sub === undefined) throw new BadRequestException('Authentication required');
    return sub;
  }
}

/**
 * The seller's order queue, tenant-scoped by the interceptor.
 *
 * `order:read` rather than a role name (ADR 0013). Note what it is NOT: the
 * suspension withdrawal set is `product:write`, `settings:write`,
 * `payout:write` and `member:write`, and `order:read`/`order:write` are
 * deliberately absent from it - PRD 6.6 requires a suspended seller to keep
 * fulfilling orders they have already taken money for.
 */
@ApiTags('orders')
@Controller('seller/orders')
export class SellerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequireCapability('order:read')
  async list(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<Page<OrderView>> {
    return this.orders.forSeller(parseLimit(limit), cursor);
  }

  @Get(':id')
  @RequireCapability('order:read')
  async get(@Param('id') id: string): Promise<OrderView> {
    return this.orders.forSellerOne(id);
  }
}
