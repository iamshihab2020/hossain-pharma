import { boolean, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';

/**
 * TENANT-OWNED. Migration 0008 puts ENABLE + FORCE + policies on it.
 *
 * PRD 9.2 onboarding step 5 asks for "at least one pickup location with
 * pincode". Phase 1 did not build it; it arrives here because inventory_items
 * is keyed by warehouse and Phase 2 owns inventory.
 *
 * Deliberately just a name and a pincode. Delivery zones, rate cards, slots and
 * serviceability are Phase 6 and will extend this table rather than replace it.
 */
export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    pincode: text('pincode').notNull(),
    /**
     * Not enforced unique per tenant by the schema: two defaults is a data
     * problem the service fixes by clearing the others in the same transaction,
     * and a partial unique index would make that a two-statement dance with an
     * intermediate state that violates it.
     */
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('warehouses_tenant_name_key').on(t.tenantId, t.name),
    index('warehouses_tenant_idx').on(t.tenantId),
  ],
);
