import { BadRequestException, Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CheckoutService, type Confirmation } from './checkout.service.js';
import type { Quote } from './quote.service.js';
import { parseConfirm, parseQuoteQuery } from './dto.js';

/**
 * Checkout is AUTHENTICATED, unlike the cart.
 *
 * A guest may fill a basket - that is PRD 9.1's whole point about drop-off -
 * but placing an order creates a payment obligation and a seller-visible record
 * with a delivery address on it. There is no guest checkout, deliberately.
 *
 * No @RequireCapability: capabilities are a seller concept (ADR 0013) and the
 * buyer here is not a tenant. The global AuthGuard is the whole gate.
 */
@ApiTags('checkout')
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Get('quote')
  async quote(@Req() req: FastifyRequest, @Query('addressId') addressId: unknown): Promise<Quote> {
    return this.checkout.quote(this.userId(req), parseQuoteQuery(addressId));
  }

  @Post('confirm')
  async confirm(@Req() req: FastifyRequest, @Body() body: unknown): Promise<Confirmation> {
    return this.checkout.confirm(this.userId(req), parseConfirm(body));
  }

  /**
   * Read from the token the guard verified, never from the body.
   *
   * A `buyerUserId` field in the request would be a way to check out as
   * somebody else, and it would look completely ordinary in the DTO.
   */
  private userId(req: FastifyRequest): string {
    const sub = req.nexmarketUser?.sub;
    if (sub === undefined) throw new BadRequestException('Authentication required');
    return sub;
  }
}
