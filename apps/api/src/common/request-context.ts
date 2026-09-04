import { AsyncLocalStorage } from 'node:async_hooks';
import type { Transaction } from '@nexmarket/db';
import type { OrgRole } from '@nexmarket/shared';
import type { OrgStatus } from './guards/capability.guard.js';

/**
 * Everything a request handler is allowed to know about who is calling and on
 * whose behalf, plus the transaction that carries the tenant context.
 *
 * `tx` is here rather than in a service field because the tenant GUCs are
 * transaction-local (see withTenant). A service that reached for a connection
 * of its own would get one with no context at all, which under FORCE RLS reads
 * zero rows - or, worse, would be tempted to import `db` and read everyone's.
 */
export type RequestContext = {
  readonly userId: string;
  readonly platformRole: 'BUYER' | 'ADMIN';
  readonly tenantId: string | null;
  readonly roles: readonly OrgRole[];
  /**
   * The active organisation's PRD 6.6 status, or null when no tenant is
   * selected. Carried because SUSPENDED withdraws capabilities the roles still
   * grant, and the handler must not have to look that up for itself.
   */
  readonly orgStatus: OrgStatus | null;
  readonly tx: Transaction;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Throws when called outside a request. That is deliberate: a service reaching
 * for the transaction outside the interceptor's scope has no tenant context,
 * and the correct outcome is a loud failure rather than a silent fallback to a
 * raw connection. The raw handle is exactly what PRD 6.4 criterion 2 bans.
 */
export function getRequestContext(): RequestContext {
  const ctx = storage.getStore();
  if (ctx === undefined) {
    throw new Error('No request context: this code ran outside the TenantInterceptor');
  }
  return ctx;
}
