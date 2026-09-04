import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Postgres `ltree`, which Drizzle has no built-in type for.
 *
 * The extension is created in migration 0008 (DDL the app role deliberately
 * cannot perform). The application only ever does two things with the column -
 * `path <@ $1` for a subtree and `nlevel(path)` for depth - so mapping it as an
 * opaque string is enough, and the GiST index in that migration is what makes
 * the subtree query worth having.
 */
const ltree = customType<{ data: string; driverData: string }>({
  dataType: () => 'ltree',
});

/**
 * PLATFORM-OWNED (PRD 6.2): no tenant_id, no RLS.
 *
 * A category shared by competing sellers is the point of PRD 8.3. Writes are
 * admin-guarded at the API; there is deliberately no policy on this table, and
 * migration 0008 says so where someone would otherwise "fix" the omission.
 *
 * Three levels, capped by a CHECK on nlevel(path) rather than by application
 * code - the depth limit is a property of the data, and PRD 9.1's breadcrumb
 * and browse behaviour both assume it.
 */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id'),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /**
     * Materialised path, e.g. `electronics.phones.smartphones`. Labels are the
     * slugs with hyphens replaced by underscores, because ltree labels admit
     * only [A-Za-z0-9_].
     */
    path: ltree('path').notNull(),
    /**
     * PRD 8.1. PERISHABLE drives batch/expiry handling (Phase 6 FEFO
     * allocation); RESTRICTED drives the Phase 4 age gate and, from Phase 2,
     * routes a listing through admin review before it can go ACTIVE.
     */
    isPerishable: boolean('is_perishable').notNull().default(false),
    isRestricted: boolean('is_restricted').notNull().default(false),
    position: text('position'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('categories_parent_idx').on(t.parentId),
    // The GiST index is what makes `path <@ 'electronics'` a subtree lookup
    // rather than a sequential scan. Declared in the migration, not here -
    // drizzle-kit cannot express a GiST operator class.
    index('categories_path_btree_idx').on(t.path),
  ],
);

export const attributeDatatype = pgEnum('attribute_datatype', ['TEXT', 'NUMBER', 'BOOL']);

/**
 * The per-category attribute schema. PRD 9.1: "per-category dynamic facets
 * (screen size for TVs, size/colour for fashion)".
 *
 * `isFacetable` is what Phase 3 reads to decide which filters to offer on a
 * category page. It is a column rather than a convention because the answer
 * differs per attribute: "screen size" is a facet, "box contents" is not.
 */
export const categoryAttributes = pgTable(
  'category_attributes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    datatype: attributeDatatype('datatype').notNull(),
    isRequired: boolean('is_required').notNull().default(false),
    isFacetable: boolean('is_facetable').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique('category_attributes_category_key_key').on(t.categoryId, t.key),
    index('category_attributes_category_idx').on(t.categoryId),
  ],
);
