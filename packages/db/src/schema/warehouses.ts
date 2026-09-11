import {
  boolean,
  char,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';

/**
 * TENANT-OWNED. Migration 0008 puts ENABLE + FORCE + policies on it.
 *
 * PRD 9.2 onboarding step 5 asks for "at least one pickup location with
 * pincode". Phase 1 did not build it; it arrives here because inventory_items
 * is keyed by warehouse and Phase 2 owns inventory.
 *
 * Phase 6 extended it in place, as promised. Zones, rate cards, slots and
 * serviceability live in `logistics.ts` and are platform-owned; what belongs
 * HERE is the seller's own facts about their own building.
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

    /**
     * The rest of the address, added in Phase 6.
     *
     * Phase 2 stored a pincode alone because inventory only needed a key to
     * hang stock on. Phase 6 dispatches FROM here - the packing slip prints a
     * return address and the courier is handed an origin - and a pincode is not
     * somewhere a van can go.
     *
     * Loose columns rather than the `shipping_address` JSONB shape orders use.
     * That column is a SNAPSHOT, frozen so a later edit cannot restate where
     * last year's parcel went; this is a live record the seller maintains, and
     * the two have opposite requirements.
     */
    addressLine: text('address_line').notNull().default(''),
    city: text('city').notNull().default(''),
    district: text('district').notNull().default(''),
    countryCode: char('country_code', { length: 2 }).notNull().default('BD'),
    contactPhone: text('contact_phone').notNull().default(''),

    /**
     * PRD 11 Phase 6 "pickup points": a buyer may collect from this address
     * instead of having it delivered.
     *
     * A flag on a warehouse rather than a table of its own, because a pickup
     * point IS a place the seller already holds stock - modelling it separately
     * would mean two rows describing one building and a rule about which is
     * authoritative for inventory.
     */
    isPickupPoint: boolean('is_pickup_point').notNull().default(false),

    /**
     * Ordering for the allocation strategy: lowest first.
     *
     * Multi-warehouse allocation needs a DETERMINISTIC preference or the same
     * cart splits differently on two runs and no test can pin it. The seller
     * sets the order; ties break on `id` so the sort is total.
     */
    priority: integer('priority').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('warehouses_tenant_name_key').on(t.tenantId, t.name),
    index('warehouses_tenant_idx').on(t.tenantId),
  ],
);
