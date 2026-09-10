import { sql } from 'drizzle-orm';
import type { Transaction } from '@nexmarket/db';

/**
 * The four places the tenant GUC is moved outside `withTenant`, and the only
 * four.
 *
 * Both are transaction-local (`set_config(..., true)`), both restore in a
 * `finally`, and both wrap the smallest possible amount of work. Nothing here
 * can escape onto the pooled connection, because the third argument to
 * `set_config` is `is_local` and the value dies with the transaction either way.
 *
 * They exist because two operations are legitimately not "one tenant acting on
 * its own rows", and pretending otherwise would mean writing wrong data:
 *
 *  - founding an organisation, which must write the first membership row for a
 *    tenant that did not exist when the request began;
 *  - reindexing a product for search, which is a CROSS-TENANT aggregate over
 *    every seller's public offers;
 *  - placing an order at checkout, where a BUYER - who is not a tenant - writes
 *    to four tenant-owned tables across several sellers in one transaction;
 *  - CANCELLING an order, where the same buyer writes to four tenant-owned
 *    tables belonging to ONE seller. Added in Phase 5 with the question this
 *    file demands asked and answered in writing (ADR 0019): the work is
 *    genuinely a non-tenant initiating tenant-scoped writes, not tenant-scoped
 *    work being done from the wrong place.
 *
 * The third was added in Phase 4 after the two alternatives were rejected in
 * writing (ADR 0017): running the whole checkout as a platform admin hands a
 * buyer's transaction every tenant's rows to solve a narrow write problem, and
 * a buyer-insert policy on `orders` would let a buyer forge an order attributed
 * to themselves against any seller - an order row is what a seller's fulfilment
 * queue reads.
 *
 * IF YOU ARE ADDING A FIFTH, STOP. The question to answer first is whether the
 * work is genuinely not tenant-scoped, or whether it is tenant-scoped work
 * being done from the wrong place. It has been the second more often than the
 * first.
 */

/**
 * Runs `fn` with NO tenant selected, then restores whatever was set.
 *
 * For work that is correct only across tenants. On `listings` this makes
 * `public_active_offers` the governing policy - every seller's ACTIVE offers
 * and nothing else - which is precisely the input a search document needs.
 *
 * It cannot be used to widen a tenant's own view of its private rows: with no
 * tenant selected, DRAFT and PAUSED listings are invisible to everyone.
 */
export async function withoutTenantScope<T>(tx: Transaction, fn: () => Promise<T>): Promise<T> {
  const previous = await currentTenant(tx);
  await setTenant(tx, '');
  try {
    return await fn();
  } finally {
    await setTenant(tx, previous);
  }
}

/**
 * Runs `fn` as `tenantId`, then restores whatever was set.
 *
 * Safe only when `tenantId` is a value THIS transaction produced. Three cases:
 * founding an organisation; checkout, where the seller id comes from
 * `listings.tenant_id`; and buyer cancellation, where it comes from
 * `orders.tenant_id` after `own_orders` has proved the order is the caller's.
 * In both of the latter the id is read from the database inside the
 * transaction, because the buyer chose a LISTING or an ORDER, never a tenant.
 *
 * Never pass a caller-supplied id: that is exactly the authorisation check the
 * interceptor exists to perform, and doing it here would move it somewhere
 * nobody looks.
 */
export async function asTenantScope<T>(
  tx: Transaction,
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = await currentTenant(tx);
  await setTenant(tx, tenantId);
  try {
    return await fn();
  } finally {
    await setTenant(tx, previous);
  }
}

async function currentTenant(tx: Transaction): Promise<string> {
  const result = await tx.execute<{ tenant: string | null }>(
    sql`SELECT current_setting('app.tenant_id', true) AS tenant`,
  );
  return result.rows[0]?.tenant ?? '';
}

async function setTenant(tx: Transaction, value: string): Promise<void> {
  // Still is_local = true. The scope changes; the transaction-locality does not.
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${value}, true)`);
}
