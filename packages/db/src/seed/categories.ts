import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * Three levels, per PRD 8.1 and the depth CHECK in migration 0008.
 *
 * Deliberately generic verticals. This is a universal marketplace, and the seed
 * is the first place that claim is either true or obviously false.
 *
 * `fresh-produce` is PERISHABLE (batch/expiry handling, Phase 6 FEFO) and
 * `spirits` is RESTRICTED (the Phase 4 age gate, and from Phase 2 the reason a
 * listing in that category needs admin review before it can go ACTIVE). One of
 * each, so both flags have a row that exercises them.
 */
const CATEGORIES = [
  { slug: 'electronics', name: 'Electronics', parent: null },
  { slug: 'phones', name: 'Phones & Tablets', parent: 'electronics' },
  { slug: 'smartphones', name: 'Smartphones', parent: 'phones' },
  { slug: 'audio', name: 'Audio', parent: 'electronics' },
  { slug: 'headphones', name: 'Headphones', parent: 'audio' },
  { slug: 'fashion', name: 'Fashion', parent: null },
  { slug: 'clothing', name: 'Clothing', parent: 'fashion' },
  { slug: 'groceries', name: 'Groceries', parent: null },
  { slug: 'fresh-produce', name: 'Fresh Produce', parent: 'groceries', perishable: true },
  { slug: 'beverages', name: 'Beverages', parent: 'groceries' },
  { slug: 'spirits', name: 'Spirits', parent: 'beverages', restricted: true },
] as const;

/**
 * PRD 9.1: "per-category dynamic facets (screen size for TVs, size/colour for
 * fashion)". Phase 3 reads `isFacetable` to decide which filters a category
 * page offers.
 */
const ATTRIBUTES = [
  { category: 'smartphones', key: 'screen_size_in', label: 'Screen size (in)', datatype: 'NUMBER' as const, required: true, facetable: true },
  { category: 'smartphones', key: 'storage_gb', label: 'Storage (GB)', datatype: 'NUMBER' as const, required: true, facetable: true },
  { category: 'smartphones', key: 'colour', label: 'Colour', datatype: 'TEXT' as const, required: true, facetable: true },
  { category: 'smartphones', key: 'dual_sim', label: 'Dual SIM', datatype: 'BOOL' as const, required: false, facetable: false },
  { category: 'headphones', key: 'form_factor', label: 'Form factor', datatype: 'TEXT' as const, required: true, facetable: true },
  { category: 'clothing', key: 'size', label: 'Size', datatype: 'TEXT' as const, required: true, facetable: true },
  // Fresh produce carries facetable attributes so the per-category facet path
  // has a category to exercise that is not also the buy-box fixture. Keeping
  // the two apart means a test that filters produce cannot be perturbed by a
  // test that publishes a phone.
  { category: 'fresh-produce', key: 'origin', label: 'Origin', datatype: 'TEXT' as const, required: false, facetable: true },
  { category: 'fresh-produce', key: 'organic', label: 'Organic', datatype: 'BOOL' as const, required: false, facetable: false },
] as const;

/**
 * ltree labels admit only [A-Za-z0-9_], so a hyphenated slug becomes an
 * underscored label. The slug stays the public identifier; the label is an
 * implementation detail of the path.
 */
function label(slug: string): string {
  return slug.replace(/-/g, '_');
}

export async function seedCategories(db: Db): Promise<number> {
  const pathBySlug = new Map<string, string>();

  // Inserted parent-first, because a child's path is its parent's path plus its
  // own label. CATEGORIES is ordered accordingly rather than sorted here - the
  // order is meaningful and hiding it in a topological sort would let someone
  // add a row in the wrong place and get a silently wrong path.
  for (const category of CATEGORIES) {
    const parentPath = category.parent === null ? null : pathBySlug.get(category.parent);
    if (category.parent !== null && parentPath === undefined) {
      throw new Error(`Seed inconsistency: category "${category.slug}" precedes its parent`);
    }
    const path = parentPath === null || parentPath === undefined
      ? label(category.slug)
      : `${parentPath}.${label(category.slug)}`;
    pathBySlug.set(category.slug, path);

    const parentId =
      category.parent === null ? null : (await findId(db, category.parent));

    await db
      .insert(schema.categories)
      .values({
        slug: category.slug,
        name: category.name,
        path,
        parentId,
        isPerishable: 'perishable' in category ? category.perishable : false,
        isRestricted: 'restricted' in category ? category.restricted : false,
      })
      .onConflictDoNothing({ target: schema.categories.slug });
  }

  for (const attribute of ATTRIBUTES) {
    const categoryId = await findId(db, attribute.category);
    if (categoryId === null) {
      throw new Error(`Seed inconsistency: no category "${attribute.category}"`);
    }
    await db
      .insert(schema.categoryAttributes)
      .values({
        categoryId,
        key: attribute.key,
        label: attribute.label,
        datatype: attribute.datatype,
        isRequired: attribute.required,
        isFacetable: attribute.facetable,
      })
      .onConflictDoNothing();
  }

  return CATEGORIES.length;
}

async function findId(db: Db, slug: string): Promise<string | null> {
  const rows = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(eq(schema.categories.slug, slug))
    .limit(1);
  return rows[0]?.id ?? null;
}
