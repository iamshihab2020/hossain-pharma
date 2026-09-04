import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadApiEnv } from '../../config/env.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { CART_COOKIE, CART_COOKIE_OPTIONS, mintGuestToken } from './guest-token.js';
import { CartService, type CartOwner, type CartView, assertQuantity } from './cart.service.js';

/**
 * The cart, for guests and members alike.
 *
 * These are the FIRST public WRITE routes in the system. Every other @Public()
 * route is a read. That is a deliberate, narrow exception: PRD 9.1 requires a
 * guest cart, and requiring sign-in before browsing-to-basket is the single
 * biggest drop-off in a storefront. What a guest cart can do is bounded - it
 * holds listing ids and quantities, carries no money, and cannot place an
 * order, because checkout is authenticated.
 *
 * `route-coverage.e2e` lists these separately from public reads and demands a
 * justification for each, so a future public write cannot slip in unnoticed.
 *
 * IDENTITY IS RESOLVED HERE, not by AuthGuard, because a @Public() route never
 * reaches the guard's token handling. An Authorization header that is present
 * but invalid is a 401 rather than a silent downgrade to a guest cart - a
 * member whose session just expired must be told, not quietly handed an empty
 * basket.
 */
@ApiTags('cart')
@Public()
@Controller('cart')
export class CartController {
  private readonly secret = new TextEncoder().encode(loadApiEnv().JWT_ACCESS_SECRET);

  constructor(private readonly cart: CartService) {}

  @Get()
  async view(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<CartView> {
    return this.cart.view(await this.owner(req, reply));
  }

  @Post('items')
  async add(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ): Promise<CartView> {
    const { listingId, quantity } = parseAddItem(body);
    return this.cart.addItem(await this.owner(req, reply), listingId, quantity);
  }

  @Patch('items/:id')
  async setQuantity(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CartView> {
    const quantity = assertQuantity((body as { quantity?: unknown } | null)?.quantity);
    return this.cart.setQuantity(await this.owner(req, reply), id, quantity);
  }

  @Delete('items/:id')
  async remove(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id') id: string,
  ): Promise<CartView> {
    return this.cart.removeItem(await this.owner(req, reply), id);
  }

  /**
   * PRD 9.1: the guest cart is merged into the member cart on login.
   *
   * Requires a real token - this is the one cart route a guest cannot call,
   * because there is no member cart to merge into.
   */
  @Post('merge')
  async merge(@Req() req: FastifyRequest): Promise<CartView> {
    const userId = await this.signedInUser(req);
    if (userId === null) throw new UnauthorizedException('Sign in to merge a cart');

    const guestToken = req.cookies[CART_COOKIE];
    if (guestToken === undefined) return this.cart.view({ userId });
    return this.cart.merge(guestToken, userId);
  }

  /**
   * A signed-in user owns their cart; anyone else owns the cart their cookie
   * points at, and gets a cookie if they have none.
   */
  private async owner(req: FastifyRequest, reply: FastifyReply): Promise<CartOwner> {
    const userId = await this.signedInUser(req);
    if (userId !== null) return { userId };

    const existing = req.cookies[CART_COOKIE];
    if (existing !== undefined) return { guestToken: existing };

    const token = mintGuestToken();
    reply.setCookie(CART_COOKIE, token, CART_COOKIE_OPTIONS);
    return { guestToken: token };
  }

  private async signedInUser(req: FastifyRequest): Promise<string | null> {
    const header = req.headers.authorization;
    if (typeof header !== 'string') return null;
    const match = /^bearer +(.+)$/i.exec(header);
    if (match?.[1] === undefined) return null;

    const payload = await verifyAccessToken(match[1], this.secret);
    // Present but invalid: refuse rather than degrade. Silently treating an
    // expired member as a guest loses their cart and looks like data loss.
    if (payload === null) throw new UnauthorizedException('Authentication required');
    return payload.sub;
  }
}

function parseAddItem(body: unknown): { listingId: string; quantity: number } {
  const value = (body ?? {}) as { listingId?: unknown; quantity?: unknown };
  if (typeof value.listingId !== 'string' || value.listingId.length === 0) {
    throw new BadRequestException('listingId is required');
  }
  // No price field is read, ever. PRD 9.1: "client never sends a price".
  return { listingId: value.listingId, quantity: assertQuantity(value.quantity ?? 1) };
}
