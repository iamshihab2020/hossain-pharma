import { char, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { countries, currencies } from './reference.js';

/**
 * PRD 6.6 lifecycle: DRAFT -> PENDING_REVIEW -> ACTIVE <-> SUSPENDED -> CLOSED.
 * A SUSPENDED seller keeps order-fulfilment access and loses everything else,
 * so suspension never strands a buyer mid-order.
 */
export const orgStatus = pgEnum('org_status', [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'SUSPENDED',
  'CLOSED',
]);

/**
 * An organisation IS the tenant (PRD 6.1). Buyers are not tenants; they belong
 * to the platform and shop across all sellers.
 *
 * The row itself is platform-owned and admin-guarded. Every tenant-owned table
 * from Phase 1 onward carries `tenant_id uuid NOT NULL REFERENCES
 * organisations(id)` and is RLS-enforced against it.
 */
export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  legalName: text('legal_name').notNull(),
  displayName: text('display_name').notNull(),
  status: orgStatus('status').notNull().default('DRAFT'),
  countryCode: char('country_code', { length: 2 })
    .notNull()
    .references(() => countries.code),
  defaultCurrency: char('default_currency', { length: 3 })
    .notNull()
    .references(() => currencies.code),
  /** Retained by the ETL so a migrated row can be traced back to its Mongo original. */
  legacyMongoId: text('legacy_mongo_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
