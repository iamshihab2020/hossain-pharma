export { db, pool, withTenant, closeDb } from './client.js';
export { assertInteractiveTransactions, DriverCapabilityError } from './assert-driver.js';
export { makeWithTenant, type TenantContext, type Transaction } from './tenant-context.js';
export { loadDbEnv, type DbEnv } from './env.js';
export {
  upsertSearchDocument,
  pruneSearchDocument,
  upsertSearchDocumentsForTenant,
  deleteAllSearchDocuments,
  insertAllSearchDocuments,
} from './search-index.js';
export * as schema from './schema/index.js';
