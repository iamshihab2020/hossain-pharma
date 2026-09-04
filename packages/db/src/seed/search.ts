import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../schema/index.js';
import { deleteAllSearchDocuments, insertAllSearchDocuments } from '../search-index.js';
import { makeWithTenant } from '../tenant-context.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * Builds `search_documents` from the same statements the API uses.
 *
 * Deliberately NOT its own INSERT. A seed with a private copy of the
 * materialisation is a second definition of what a document is, and the first
 * time the view changes the seed starts producing an index that the running
 * application would never produce - so every search test would be testing a
 * fixture rather than the system.
 *
 * Runs with `tenantId: null`, which is what makes the aggregate cross-tenant:
 * `public_active_offers` is then the governing policy on `listings`, so the
 * cheapest offer is the cheapest across all sellers rather than within one.
 */
export async function seedSearchIndex(db: Db): Promise<number> {
  const withTenant = makeWithTenant(db);
  return withTenant({ tenantId: null, userId: null, isAdmin: false }, async (tx) => {
    await tx.execute(deleteAllSearchDocuments);
    const result = await tx.execute(insertAllSearchDocuments);
    return result.rowCount ?? 0;
  });
}
