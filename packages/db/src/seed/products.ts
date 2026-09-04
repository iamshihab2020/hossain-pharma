import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';

type Db = NodePgDatabase<typeof schema>;

type AttributeValue = { key: string; text?: string; number?: number; bool?: boolean };

/**
 * Catalogue entries. PLATFORM-OWNED (PRD 8.3) - no tenant, no RLS.
 *
 * `aurora-x1` exists to be listed by TWO sellers, which is the PRD 11
 * acceptance fixture. Everything else here is scenery, but honest scenery: a
 * single-seller product, and one in the RESTRICTED category so the Phase 2
 * review path has something real to route.
 */
const PRODUCTS = [
  {
    slug: 'aurora-x1',
    name: 'Aurora X1',
    brand: 'Aurora',
    category: 'smartphones',
    description: 'A mid-range handset with a 6.4-inch display and dual SIM.',
    attributes: [
      { key: 'screen_size_in', number: 6.4 },
      { key: 'storage_gb', number: 128 },
      { key: 'colour', text: 'Violet' },
      { key: 'dual_sim', bool: true },
    ] as AttributeValue[],
    variants: [
      { sku: 'AUR-X1-128-VIO', name: '128GB · Violet', position: 0 },
      { sku: 'AUR-X1-256-BLK', name: '256GB · Black', position: 1 },
    ],
  },
  {
    slug: 'meridian-canvas-tote',
    name: 'Meridian Canvas Tote',
    brand: 'Meridian',
    category: 'clothing',
    description: 'A heavyweight cotton tote.',
    attributes: [{ key: 'size', text: 'One size' }] as AttributeValue[],
    variants: [{ sku: 'MER-TOTE-OS', name: 'One size', position: 0 }],
  },
  {
    slug: 'harbour-single-malt',
    name: 'Harbour Single Malt',
    brand: 'Harbour',
    category: 'spirits',
    description: 'A restricted-category product, present so the age gate and the listing review path have a real row to act on.',
    attributes: [] as AttributeValue[],
    variants: [{ sku: 'HAR-SM-700', name: '700ml', position: 0 }],
  },
] as const;

export type SeededProducts = { products: number; variants: number };

export async function seedProducts(db: Db): Promise<SeededProducts> {
  let variants = 0;

  for (const product of PRODUCTS) {
    const categoryRows = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.slug, product.category))
      .limit(1);
    const categoryId = categoryRows[0]?.id;
    // A seed that silently skips rows is the same class of bug as the RLS trap
    // in org-members.ts. Fail loudly instead.
    if (categoryId === undefined) {
      throw new Error(`Seed inconsistency: no category "${product.category}"`);
    }

    await db
      .insert(schema.products)
      .values({
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        description: product.description,
        categoryId,
        // Seeded catalogue entries are already moderated. A DRAFT seed would
        // mean the demo product page is empty until someone approves it.
        status: 'ACTIVE',
      })
      .onConflictDoNothing({ target: schema.products.slug });

    const productRows = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.slug, product.slug))
      .limit(1);
    const productId = productRows[0]?.id;
    if (productId === undefined) throw new Error(`Seed failed to insert "${product.slug}"`);

    for (const variant of product.variants) {
      await db
        .insert(schema.productVariants)
        .values({ productId, sku: variant.sku, name: variant.name, position: variant.position })
        .onConflictDoNothing({ target: schema.productVariants.sku });
      variants += 1;
    }

    for (const attribute of product.attributes) {
      await db
        .insert(schema.productAttributes)
        .values({
          productId,
          key: attribute.key,
          // Exactly one of these is set, which migration 0008 enforces with a
          // CHECK. `?? null` rather than leaving them undefined, so the shape of
          // the row is the same however the fixture was written.
          valueText: attribute.text ?? null,
          valueNumber: attribute.number ?? null,
          valueBool: attribute.bool ?? null,
        })
        .onConflictDoNothing();
    }
  }

  return { products: PRODUCTS.length, variants };
}
