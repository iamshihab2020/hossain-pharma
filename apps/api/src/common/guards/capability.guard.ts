import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALL_CAPABILITIES, hasCapability, type Capability, type OrgRole } from '@nexmarket/shared';
import { CAPABILITY_KEY } from '../decorators/capabilities.decorator.js';
import { getRequestContext } from '../request-context.js';

/**
 * PRD 5.3, enforced against the capability matrix rather than role names.
 *
 * NOTE: this is NOT registered as an APP_GUARD. NestJS runs every guard before
 * any interceptor, so a guard cannot read the context the TenantInterceptor
 * establishes - `getRequestContext()` throws. The interceptor calls `check()`
 * itself, immediately after resolving the caller's roles and inside the same
 * transaction. See ADR 0009.
 *
 * The class is kept because the decision belongs here, next to the decorator
 * that declares it, and because `check` is directly testable.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.required(context);
    if (required === undefined) return true;
    const ctx = getRequestContext();
    return check(required, ctx.roles, ctx.platformRole === 'ADMIN', ctx.orgStatus);
  }

  required(context: ExecutionContext): Capability | undefined {
    return this.reflector.getAllAndOverride<Capability | undefined>(CAPABILITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }
}

export type OrgStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

/**
 * PRD 6.6, and the Phase 1 acceptance criterion it exists to serve: "Suspended
 * seller can still fulfil open orders."
 *
 * A SUSPENDED organisation is still a RESOLVABLE tenant - suspension withdraws
 * selling, not the ability to finish what is already sold. Stranding a buyer
 * mid-order is a worse outcome than letting a suspended seller ship it.
 *
 * Phase 1 has no orders yet, so nothing exercises `order:write` in anger. The
 * mechanism is real all the same: these capabilities leave the effective set
 * the moment the org is SUSPENDED, and everything else survives.
 *
 * It lives here rather than beside the state machine because it is an
 * authorisation rule, and this file is where authorisation decisions are made.
 */
const WITHDRAWN_WHILE_SUSPENDED: ReadonlySet<Capability> = new Set<Capability>([
  'product:write',
  'settings:write',
  'payout:write',
  'member:write',
]);

/**
 * A platform ADMIN passes every capability check - that is what isAdmin means.
 *
 * Note that admin access to ROWS comes from the `platform_admin_bypass` policy
 * in migration 0004, not from here. Both are needed and they are not the same
 * mechanism: this one decides whether the handler runs, that one decides which
 * rows it can see. Removing either leaves admin broken in a different way.
 */
export function check(
  required: Capability,
  roles: readonly OrgRole[],
  isAdmin: boolean,
  status: OrgStatus | null,
): boolean {
  if (isAdmin) return true;
  if (!hasCapability(roles, required)) {
    throw new ForbiddenException(`Missing capability: ${required}`);
  }
  // Status filters the set AFTER the roles grant it. An OWNER of a suspended
  // org still holds member:write by role and does not hold it in effect, and
  // the message says which of the two failed so support can tell them apart.
  if (status === 'SUSPENDED' && WITHDRAWN_WHILE_SUSPENDED.has(required)) {
    throw new ForbiddenException(`Withdrawn while the organisation is suspended: ${required}`);
  }
  return true;
}

/** The effective set, for anything that needs to show or test it rather than enforce it. */
export function effectiveCapabilities(
  roles: readonly OrgRole[],
  status: OrgStatus | null,
): Capability[] {
  const granted = ALL_CAPABILITIES.filter((c) => hasCapability(roles, c));
  if (status !== 'SUSPENDED') return granted;
  return granted.filter((c) => !WITHDRAWN_WHILE_SUSPENDED.has(c));
}
