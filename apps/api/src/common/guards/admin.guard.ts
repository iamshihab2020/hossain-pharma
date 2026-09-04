import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { PLATFORM_ADMIN_KEY } from '../decorators/platform-admin.decorator.js';

/**
 * This one CAN be a guard, unlike CapabilityGuard.
 *
 * The difference is where the fact lives: `platform_role` is a claim in the
 * access token, which AuthGuard has already put on the request, so this reads
 * the request rather than the interceptor's context. Guards run in registration
 * order, so AuthGuard must be registered before this one - and it is, in
 * app.module.ts, next to a comment saying so.
 *
 * See ADR 0009 for why the capability check could not take this shape.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required !== true) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    // 403 rather than 401: the caller IS authenticated, they are simply not an
    // admin, and a 401 would send a correctly signed-in user to log in again.
    if (request.nexmarketUser?.platformRole !== 'ADMIN') {
      throw new ForbiddenException('Platform administrators only');
    }
    return true;
  }
}
