import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { Capability } from '@nexmarket/shared';

export const CAPABILITY_KEY = 'nexmarket:capability';

/**
 * PRD 5.3. Declares the capability a route needs, never the role.
 *
 * `@RequireCapability('member:write')` survives adding a sub-role or moving one
 * permission between roles; `role === 'OWNER'` does not. The matrix in
 * @nexmarket/shared is the single place the mapping lives.
 *
 * Enforced by the TenantInterceptor rather than a guard - see ADR 0009 for why
 * it cannot be a guard.
 */
export const RequireCapability = (capability: Capability): CustomDecorator<string> =>
  SetMetadata(CAPABILITY_KEY, capability);
