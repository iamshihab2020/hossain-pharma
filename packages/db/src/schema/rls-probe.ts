import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';

/**
 * Exists solely to prove tenant isolation works, before any real data depends
 * on it. The smallest possible tenant-owned table: a tenant_id and a payload.
 *
 * Task 7's suite reads and writes it from two tenants over one shared pool and
 * asserts zero cross-reads (PRD 6.4 criterion 3, success criterion S1).
 *
 * Phase 1 keeps this table. It is cheap, and a permanently green isolation test
 * running against a table with no business meaning is a canary worth having:
 * when it goes red, the cause is the RLS machinery itself and nothing else.
 */
export const rlsProbe = pgTable('rls_probe', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  payload: text('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
