import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { loadApiEnv } from '../../config/env.js';
import { verifyAccessToken, type AccessTokenPayload } from '../../modules/auth/tokens.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

/**
 * Exported so the route-coverage test can tell THIS 401 apart from a 401 a
 * handler raised for its own reasons - POST /auth/refresh with no cookie, for
 * instance, is public and still answers 401.
 */
export const AUTH_REQUIRED = 'Authentication required';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Set by AuthGuard, read by TenantInterceptor. Optional in the type because
     * a @Public() route never has one - which is exactly the case the
     * interceptor has to handle rather than assume away.
     */
    nexmarketUser?: AccessTokenPayload;
  }
}

/**
 * PRD 13: deny by default.
 *
 * Registered globally through APP_GUARD, so a controller added tomorrow with no
 * decorators at all is CLOSED. The alternative - opting each controller in with
 * @UseGuards - fails silently the first time someone forgets, and the failure
 * mode is an open endpoint rather than a broken one.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly secret = new TextEncoder().encode(loadApiEnv().JWT_ACCESS_SECRET);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const payload = await verifyAccessToken(bearer(request) ?? '', this.secret);
    // One message for every failure - missing, malformed, expired, forged.
    // Distinguishing them tells an attacker which half of the problem to fix.
    if (payload === null) throw new UnauthorizedException(AUTH_REQUIRED);

    request.nexmarketUser = payload;
    return true;
  }
}

function bearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  // Case-insensitive scheme: RFC 7235 says the scheme is case-insensitive, and
  // a client sending "bearer" is not an attacker, just a client.
  const match = /^bearer +(.+)$/i.exec(header);
  return match?.[1] ?? null;
}
