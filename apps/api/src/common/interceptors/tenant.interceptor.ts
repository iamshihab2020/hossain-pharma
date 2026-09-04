import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { schema, withTenant, type Transaction } from '@nexmarket/db';
import type { OrgRole } from '@nexmarket/shared';
import type { FastifyRequest } from 'fastify';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { CapabilityGuard, check, type OrgStatus } from '../guards/capability.guard.js';
import { runWithContext } from '../request-context.js';

const TENANT_HEADER = 'x-tenant-id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PRD 6.4 criterion 1 - the item Phase 0 deliberately deferred.
 *
 * Every authenticated request runs inside ONE withTenant transaction, opened
 * here and handed to services through the AsyncLocalStorage context. The
 * handler therefore cannot execute outside a tenant context even by accident:
 * there is no other connection for it to reach.
 *
 * Two membership lookups happen per tenant-scoped request - one to decide
 * whether the caller may act as the requested tenant, one inside the scoped
 * transaction to read their roles. That is one more round trip than strictly
 * necessary. The obvious saving, putting membership in the access token, is
 * refused on purpose: revoking someone's membership would then take effect at
 * the next token refresh rather than immediately, and an authorisation decision
 * that lags by the access-token TTL is the wrong trade. See ADR 0009.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly capabilities: CapabilityGuard,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return next.handle();

    return from(this.run(context, next));
  }

  private async run(context: ExecutionContext, next: CallHandler): Promise<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = request.nexmarketUser;
    // AuthGuard runs first and rejects anything without a valid token, so this
    // is unreachable in a correctly wired app. It is a loud failure rather than
    // a silent `tenantId: null` because "the guard was removed" and "this user
    // has no tenant" must never look the same.
    if (user === undefined) throw new ForbiddenException('Authentication required');

    const isAdmin = user.platformRole === 'ADMIN';
    const tenantId = this.requestedTenant(request);

    if (tenantId !== null) {
      const resolved = await this.resolveTenant(user.sub, tenantId, isAdmin);
      // A platform admin may act as any tenant; that is the approval queue.
      // Anyone else presenting a tenant they are not a member of gets 403,
      // never 404 and never a silent downgrade to null - a silent downgrade
      // would serve them an empty list and look like an ordinary empty page.
      // A tenant that does not exist gets the same 403 as one the caller is not
      // in, so the header is not an oracle for which organisation ids are real.
      if (resolved === null || (resolved.roles.length === 0 && !isAdmin)) {
        throw new ForbiddenException('Not a member of that organisation');
      }
      // PRD 6.6: CLOSED is terminal. It is not a tenant anyone acts as, admin
      // included - reopening one is a data-repair job, not a request.
      if (resolved.status === 'CLOSED') {
        throw new ForbiddenException('That organisation is closed');
      }
      this.enforce(context, resolved.roles, isAdmin, resolved.status);
      return this.runScoped(user, tenantId, resolved.roles, resolved.status, isAdmin, next);
    }

    this.enforce(context, [], isAdmin, null);
    return this.runScoped(user, null, [], null, isAdmin, next);
  }

  /**
   * The capability check runs HERE, not in a guard registered on APP_GUARD.
   *
   * NestJS runs all guards before any interceptor, so a guard cannot read the
   * roles this interceptor resolves. Doing it here also closes a gap the
   * two-component design would have left open: the roles that authorise the
   * request are the same roles the request runs with, read once, rather than
   * two reads with a window between them.
   */
  private enforce(
    context: ExecutionContext,
    roles: readonly OrgRole[],
    isAdmin: boolean,
    status: OrgStatus | null,
  ): void {
    const required = this.capabilities.required(context);
    if (required !== undefined) check(required, roles, isAdmin, status);
  }

  private requestedTenant(request: FastifyRequest): string | null {
    const header = request.headers[TENANT_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    if (value === undefined || value === '') return null;
    // Rejected here rather than passed through: set_config accepts any string,
    // and the policy's NULLIF(...)::uuid cast then raises inside the query,
    // which surfaces as a 500 on what is really a caller error. 400 is honest.
    if (!UUID.test(value)) throw new BadRequestException(`Invalid ${TENANT_HEADER}`);
    return value;
  }

  /**
   * Reads the caller's roles in one organisation, and that organisation's
   * status, with NO tenant context set.
   *
   * This is the lookup that decides tenantId, so it cannot itself require
   * tenantId. Migration 0004's `own_membership` SELECT-only policy is what
   * makes it possible, and its lack of a WITH CHECK is what stops it becoming
   * a way to grant yourself a membership. See plan decision D-A, and migration
   * 0006 for why that policy only applies while no tenant is selected.
   */
  private async resolveTenant(
    userId: string,
    tenantId: string,
    isAdmin: boolean,
  ): Promise<{ roles: OrgRole[]; status: OrgStatus } | null> {
    return withTenant({ tenantId: null, userId, isAdmin }, async (tx: Transaction) => {
      const orgs = await tx
        .select({ status: schema.organisations.status })
        .from(schema.organisations)
        .where(eq(schema.organisations.id, tenantId))
        .limit(1);
      const org = orgs[0];
      if (org === undefined) return null;

      const rows = await tx
        .select({ role: schema.orgMembers.role })
        .from(schema.orgMembers)
        .where(and(eq(schema.orgMembers.userId, userId), eq(schema.orgMembers.tenantId, tenantId)));
      // One human can hold several roles in one org (PRD 5.1); the answer is
      // the union of all of them, which hasCapability computes.
      return { roles: rows.map((r) => r.role), status: org.status };
    });
  }

  private runScoped(
    user: { sub: string; platformRole: 'BUYER' | 'ADMIN' },
    tenantId: string | null,
    roles: readonly OrgRole[],
    orgStatus: OrgStatus | null,
    isAdmin: boolean,
    next: CallHandler,
  ): Promise<unknown> {
    return withTenant({ tenantId, userId: user.sub, isAdmin }, (tx: Transaction) =>
      runWithContext(
        { userId: user.sub, platformRole: user.platformRole, tenantId, roles, orgStatus, tx },
        // An exception from the handler propagates out of withTenant and rolls
        // the transaction back, which is the behaviour a failed write wants.
        () => lastValueFrom(next.handle()),
      ),
    );
  }
}
