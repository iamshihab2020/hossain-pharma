import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema/index.js';

export type TenantContext = {
  readonly tenantId: string | null;
  readonly isAdmin: boolean;
};

type Db = NodePgDatabase<typeof schema>;

/** The transaction handle handed to a withTenant callback. */
export type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * PRD section 6.4 - MANDATORY IMPLEMENTATION RULE.
 *
 * Tenant context is set with `set_config(name, value, true)`. That third
 * argument is `is_local`, which makes it exactly equivalent to SET LOCAL: the
 * value is scoped to THIS transaction and discarded at COMMIT or ROLLBACK.
 *
 * A plain `SET` would persist on the physical connection after the request
 * ends. The pooler then hands that connection to the next request, possibly for
 * a different tenant, which inherits the previous tenant's context and reads
 * their rows. It does not show up in single-user testing and stays invisible
 * until concurrent load.
 *
 * NEVER replace set_config(..., true) with a plain SET, and never set tenant
 * context outside a transaction.
 *
 * Note the empty string for a null tenant. Migration 0001 wraps the policy
 * comparison in NULLIF(..., '') so that reads back as NULL, and `tenant_id =
 * NULL` is NULL rather than TRUE - which means no rows. Missing context fails
 * closed.
 */
export function makeWithTenant(database: Db) {
  return async function withTenant<T>(
    ctx: TenantContext,
    fn: (tx: Transaction) => Promise<T> | T,
  ): Promise<T> {
    return database.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true)`);
      await tx.execute(sql`SELECT set_config('app.is_admin', ${String(ctx.isAdmin)}, true)`);
      return fn(tx);
    });
  };
}

// The production binding lives in client.ts, alongside the pool it closes over.
// Keeping this module free of singletons is what lets it be tested against a
// throwaway container without ever reading DATABASE_URL.
