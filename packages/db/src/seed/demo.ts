import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';
import { makeWithTenant } from '../tenant-context.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * A demoable market: enough competing offers that the buy box has something to
 * rank and the storefront has something to render.
 *
 * The reference-data seed exists to prove the schema holds. THIS one exists so
 * a person can look at the product page and see what the system is for, which
 * is a different job and needs different data: several sellers on one product,
 * a low-stock offer, an offer whose cheaper sticker price loses on shipping.
 *
 * The Phase 2 acceptance fixture in `listings.ts` is deliberately NOT touched.
 * It encodes a specific documented assertion about the buy box, and adding
 * sellers to `aurora-x1` would change the numbers that test names.
 *
 * The Redmi Note 14 offers below reproduce, exactly, the comparison table in
 * `docs/DESIGN-DIRECTION.md`. That table was written as an illustration; making
 * it a real query result means the design document and the storefront cannot
 * quietly disagree.
 *
 * Amounts are integer minor units (paisa): 31,600.00 BDT is 3_160_000.
 */

/** Four more BD sellers, so a product page can show a real spread. */
const DEMO_ORGS = [
  {
    slug: 'bengal-tech',
    legalName: 'Bengal Tech Trading Ltd',
    displayName: 'Bengal Tech',
    countryCode: 'BD',
    defaultCurrency: 'BDT',
  },
  {
    slug: 'dhaka-digital',
    legalName: 'Dhaka Digital Enterprise',
    displayName: 'Dhaka Digital',
    countryCode: 'BD',
    defaultCurrency: 'BDT',
  },
  {
    slug: 'sky-electronics',
    legalName: 'Sky Electronics Ltd',
    displayName: 'Sky Electronics',
    countryCode: 'BD',
    defaultCurrency: 'BDT',
  },
  {
    slug: 'rangpur-mobile',
    legalName: 'Rangpur Mobile Hub',
    displayName: 'Rangpur Mobile Hub',
    countryCode: 'BD',
    defaultCurrency: 'BDT',
  },
] as const;

const DEMO_WAREHOUSES = [
  { orgSlug: 'bengal-tech', name: 'Bengal Tech · Elephant Road', pincode: '1205' },
  { orgSlug: 'dhaka-digital', name: 'Dhaka Digital · Mirpur', pincode: '1216' },
  { orgSlug: 'sky-electronics', name: 'Sky Electronics · Agrabad', pincode: '4100' },
  { orgSlug: 'rangpur-mobile', name: 'Rangpur Mobile · Station Road', pincode: '5400' },
  { orgSlug: 'verdant-grocers', name: 'Verdant · Karwan Bazar', pincode: '1215' },
] as const;

type AttributeValue = { key: string; text?: string; number?: number; bool?: boolean };

type DemoProduct = {
  slug: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  attributes: AttributeValue[];
  variants: { sku: string; name: string; position: number }[];
};

const DEMO_PRODUCTS: readonly DemoProduct[] = [
  {
    slug: 'redmi-note-14-5g',
    name: 'Redmi Note 14 5G',
    brand: 'Xiaomi',
    category: 'smartphones',
    description:
      'A 6.67-inch AMOLED handset with a 5110 mAh battery and 45W charging. Dual SIM, 5G on both slots.',
    attributes: [
      { key: 'screen_size_in', number: 6.67 },
      { key: 'storage_gb', number: 256 },
      { key: 'colour', text: 'Midnight Black' },
      { key: 'dual_sim', bool: true },
    ],
    variants: [
      { sku: 'RN14-8-256-BLK', name: '8GB / 256GB · Midnight Black', position: 0 },
      { sku: 'RN14-6-128-BLU', name: '6GB / 128GB · Ocean Blue', position: 1 },
    ],
  },
  {
    slug: 'galaxy-a26-5g',
    name: 'Galaxy A26 5G',
    brand: 'Samsung',
    category: 'smartphones',
    description: 'A 6.7-inch Super AMOLED display with a 50MP main camera and four years of updates.',
    attributes: [
      { key: 'screen_size_in', number: 6.7 },
      { key: 'storage_gb', number: 128 },
      { key: 'colour', text: 'Peach Sand' },
      { key: 'dual_sim', bool: true },
    ],
    variants: [{ sku: 'SGA26-8-128-PCH', name: '8GB / 128GB · Peach Sand', position: 0 }],
  },
  {
    slug: 'infinix-hot-50',
    name: 'Infinix Hot 50',
    brand: 'Infinix',
    category: 'smartphones',
    description: 'An entry 5G handset with a 120Hz display, built for long battery life over raw speed.',
    attributes: [
      { key: 'screen_size_in', number: 6.78 },
      { key: 'storage_gb', number: 128 },
      { key: 'colour', text: 'Titanium Grey' },
      { key: 'dual_sim', bool: true },
    ],
    variants: [{ sku: 'INF-H50-4-128-GRY', name: '4GB / 128GB · Titanium Grey', position: 0 }],
  },
  {
    slug: 'soundcore-life-q35',
    name: 'Soundcore Life Q35',
    brand: 'Anker',
    category: 'headphones',
    description: 'Over-ear noise cancelling headphones with LDAC and 40 hours of playback.',
    attributes: [
      { key: 'colour', text: 'Obsidian' },
      { key: 'wireless', bool: true },
    ],
    variants: [{ sku: 'ANK-Q35-OBS', name: 'Obsidian', position: 0 }],
  },
  {
    slug: 'edifier-w820nb',
    name: 'Edifier W820NB',
    brand: 'Edifier',
    category: 'headphones',
    description: 'Hybrid noise cancelling on a budget, with a 49-hour battery.',
    attributes: [
      { key: 'colour', text: 'Ivory' },
      { key: 'wireless', bool: true },
    ],
    variants: [{ sku: 'EDF-W820-IVY', name: 'Ivory', position: 0 }],
  },
  {
    slug: 'cotton-panjabi-classic',
    name: 'Classic Cotton Panjabi',
    brand: 'Meridian',
    category: 'clothing',
    description: 'A full-sleeve panjabi in handloom cotton, cut for Dhaka summers.',
    attributes: [
      { key: 'size', text: 'L' },
      { key: 'colour', text: 'Off White' },
    ],
    variants: [
      { sku: 'MER-PAN-L-WHT', name: 'L · Off White', position: 0 },
      { sku: 'MER-PAN-XL-WHT', name: 'XL · Off White', position: 1 },
    ],
  },
  {
    slug: 'himsagar-mango-5kg',
    name: 'Himsagar Mango, 5kg',
    brand: 'Verdant',
    // `groceries` rather than the more obvious `fresh-produce`, deliberately.
    // `search.e2e` scopes every facet assertion to fresh-produce on the stated
    // premise that no other suite writes there, and the demo seed runs inside
    // that suite's database. A mango here would have moved brand and attribute
    // counts in a test file that had done nothing wrong.
    category: 'groceries',
    description: 'Rajshahi Himsagar, picked ripe and packed the same day. Sold by the 5kg crate.',
    attributes: [
      { key: 'weight_kg', number: 5 },
      { key: 'origin', text: 'Rajshahi' },
    ],
    variants: [{ sku: 'VRD-MNG-HIM-5', name: '5kg crate', position: 0 }],
  },
  {
    slug: 'gold-leaf-tea-500g',
    name: 'Gold Leaf Tea, 500g',
    brand: 'Verdant',
    category: 'beverages',
    description: 'Sylhet orthodox black tea, second flush, loose leaf.',
    attributes: [
      { key: 'weight_g', number: 500 },
      { key: 'origin', text: 'Sylhet' },
    ],
    variants: [{ sku: 'VRD-TEA-GL-500', name: '500g pouch', position: 0 }],
  },
] as const;

type DemoListing = {
  orgSlug: string;
  sku: string;
  priceAmount: number;
  shippingAmount: number;
  dispatchDays: number;
  stock: number;
};

/**
 * The offers.
 *
 * `RN14-8-256-BLK` is the showcase, and the numbers are chosen so the table
 * teaches the buy box rather than merely filling it:
 *
 *   dhaka-digital   31,190 + 450 = 31,640   cheapest STICKER price, second overall
 *   bengal-tech     31,600 +   0 = 31,600   winner on LANDED price
 *   sky-electronics 31,900 +   0 = 31,900
 *   rangpur-mobile  32,400 +  90 = 32,490   two units left, so the band reads LOW_STOCK
 */
const DEMO_LISTINGS: readonly DemoListing[] = [
  // Redmi Note 14 5G — four sellers, the design document's table.
  { orgSlug: 'bengal-tech', sku: 'RN14-8-256-BLK', priceAmount: 3_160_000, shippingAmount: 0, dispatchDays: 1, stock: 14 },
  { orgSlug: 'dhaka-digital', sku: 'RN14-8-256-BLK', priceAmount: 3_119_000, shippingAmount: 45_000, dispatchDays: 5, stock: 8 },
  { orgSlug: 'sky-electronics', sku: 'RN14-8-256-BLK', priceAmount: 3_190_000, shippingAmount: 0, dispatchDays: 2, stock: 22 },
  { orgSlug: 'rangpur-mobile', sku: 'RN14-8-256-BLK', priceAmount: 3_240_000, shippingAmount: 9_000, dispatchDays: 3, stock: 2 },
  // The other variant, thinner competition.
  { orgSlug: 'bengal-tech', sku: 'RN14-6-128-BLU', priceAmount: 2_649_000, shippingAmount: 0, dispatchDays: 1, stock: 9 },
  { orgSlug: 'sky-electronics', sku: 'RN14-6-128-BLU', priceAmount: 2_690_000, shippingAmount: 0, dispatchDays: 2, stock: 6 },

  // Galaxy A26 — three sellers, winner also cheapest, so not every page is a lesson.
  { orgSlug: 'sky-electronics', sku: 'SGA26-8-128-PCH', priceAmount: 3_450_000, shippingAmount: 0, dispatchDays: 2, stock: 11 },
  { orgSlug: 'bengal-tech', sku: 'SGA26-8-128-PCH', priceAmount: 3_499_000, shippingAmount: 0, dispatchDays: 1, stock: 4 },
  { orgSlug: 'acme-electronics', sku: 'SGA26-8-128-PCH', priceAmount: 3_520_000, shippingAmount: 12_000, dispatchDays: 2, stock: 7 },

  // Infinix Hot 50 — two sellers.
  { orgSlug: 'dhaka-digital', sku: 'INF-H50-4-128-GRY', priceAmount: 1_449_000, shippingAmount: 0, dispatchDays: 3, stock: 18 },
  { orgSlug: 'rangpur-mobile', sku: 'INF-H50-4-128-GRY', priceAmount: 1_425_000, shippingAmount: 9_000, dispatchDays: 4, stock: 13 },

  // Headphones.
  { orgSlug: 'acme-electronics', sku: 'ANK-Q35-OBS', priceAmount: 1_099_000, shippingAmount: 0, dispatchDays: 1, stock: 15 },
  { orgSlug: 'bengal-tech', sku: 'ANK-Q35-OBS', priceAmount: 1_085_000, shippingAmount: 6_000, dispatchDays: 2, stock: 9 },
  { orgSlug: 'sky-electronics', sku: 'ANK-Q35-OBS', priceAmount: 1_120_000, shippingAmount: 0, dispatchDays: 2, stock: 3 },
  { orgSlug: 'dhaka-digital', sku: 'EDF-W820-IVY', priceAmount: 649_000, shippingAmount: 0, dispatchDays: 2, stock: 25 },
  { orgSlug: 'acme-electronics', sku: 'EDF-W820-IVY', priceAmount: 665_000, shippingAmount: 0, dispatchDays: 1, stock: 12 },

  // Clothing.
  { orgSlug: 'meridian-fashion', sku: 'MER-PAN-L-WHT', priceAmount: 289_000, shippingAmount: 8_000, dispatchDays: 3, stock: 30 },
  { orgSlug: 'northwind-home', sku: 'MER-PAN-L-WHT', priceAmount: 295_000, shippingAmount: 0, dispatchDays: 4, stock: 16 },
  { orgSlug: 'meridian-fashion', sku: 'MER-PAN-XL-WHT', priceAmount: 289_000, shippingAmount: 8_000, dispatchDays: 3, stock: 21 },

  // Groceries.
  { orgSlug: 'verdant-grocers', sku: 'VRD-MNG-HIM-5', priceAmount: 148_000, shippingAmount: 6_000, dispatchDays: 1, stock: 40 },
  { orgSlug: 'northwind-home', sku: 'VRD-MNG-HIM-5', priceAmount: 155_000, shippingAmount: 0, dispatchDays: 2, stock: 12 },
  { orgSlug: 'verdant-grocers', sku: 'VRD-TEA-GL-500', priceAmount: 62_000, shippingAmount: 6_000, dispatchDays: 1, stock: 60 },
] as const;

const CURRENCY = 'BDT';

export type DemoSummary = {
  demoOrganisations: number;
  demoProducts: number;
  demoVariants: number;
  demoWarehouses: number;
  demoListings: number;
};

/**
 * Runs after the reference seed and before the search index, for the reason
 * `index.ts` already documents: a document built before these listings exist
 * describes a catalogue nobody is selling.
 */
export async function seedDemoMarket(db: Db): Promise<DemoSummary> {
  const withTenant = makeWithTenant(db);

  await db
    .insert(schema.organisations)
    .values(DEMO_ORGS.map((o) => ({ ...o, status: 'ACTIVE' as const })))
    .onConflictDoNothing({ target: schema.organisations.slug });

  const orgs = await db
    .select({ id: schema.organisations.id, slug: schema.organisations.slug })
    .from(schema.organisations);
  const orgBySlug = new Map(orgs.map((o) => [o.slug, o.id]));

  // ---- catalogue: platform-owned, no tenant, direct insert ----------------
  let variantCount = 0;
  for (const product of DEMO_PRODUCTS) {
    const categoryRows = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.slug, product.category))
      .limit(1);
    const categoryId = categoryRows[0]?.id;
    if (categoryId === undefined) {
      throw new Error(`Demo seed inconsistency: no category "${product.category}"`);
    }

    await db
      .insert(schema.products)
      .values({
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        description: product.description,
        categoryId,
        status: 'ACTIVE',
      })
      .onConflictDoNothing({ target: schema.products.slug });

    const productRows = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.slug, product.slug))
      .limit(1);
    const productId = productRows[0]?.id;
    if (productId === undefined) throw new Error(`Demo seed failed to insert "${product.slug}"`);

    for (const variant of product.variants) {
      await db
        .insert(schema.productVariants)
        .values({ productId, sku: variant.sku, name: variant.name, position: variant.position })
        .onConflictDoNothing({ target: schema.productVariants.sku });
      variantCount += 1;
    }

    for (const attribute of product.attributes) {
      await db
        .insert(schema.productAttributes)
        .values({
          productId,
          key: attribute.key,
          valueText: attribute.text ?? null,
          valueNumber: attribute.number ?? null,
          valueBool: attribute.bool ?? null,
        })
        .onConflictDoNothing();
    }
  }

  // ---- warehouses and listings: FORCE RLS, so withTenant or nothing -------
  for (const warehouse of DEMO_WAREHOUSES) {
    const tenantId = orgBySlug.get(warehouse.orgSlug);
    if (tenantId === undefined) {
      throw new Error(`Demo seed inconsistency: no organisation "${warehouse.orgSlug}"`);
    }
    await withTenant({ tenantId, userId: null, isAdmin: false }, async (tx) => {
      await tx
        .insert(schema.warehouses)
        .values({ tenantId, name: warehouse.name, pincode: warehouse.pincode, isDefault: true })
        .onConflictDoNothing();
    });
  }

  const variants = await db
    .select({ id: schema.productVariants.id, sku: schema.productVariants.sku })
    .from(schema.productVariants);
  const variantBySku = new Map(variants.map((v) => [v.sku, v.id]));

  for (const listing of DEMO_LISTINGS) {
    const tenantId = orgBySlug.get(listing.orgSlug);
    const variantId = variantBySku.get(listing.sku);
    if (tenantId === undefined || variantId === undefined) {
      throw new Error(
        `Demo seed inconsistency: no organisation "${listing.orgSlug}" or variant "${listing.sku}"`,
      );
    }

    await withTenant({ tenantId, userId: null, isAdmin: false }, async (tx) => {
      // The seller's own default warehouse, whichever seed created it. A demo
      // listing attached to another tenant's warehouse would be invisible here
      // anyway - RLS would refuse the read - so this cannot silently mis-file.
      const warehouseRows = await tx
        .select({ id: schema.warehouses.id })
        .from(schema.warehouses)
        .where(eq(schema.warehouses.isDefault, true))
        .limit(1);
      const warehouseId = warehouseRows[0]?.id;
      if (warehouseId === undefined) {
        throw new Error(`Demo seed inconsistency: no warehouse for "${listing.orgSlug}"`);
      }

      await tx
        .insert(schema.listings)
        .values({
          tenantId,
          variantId,
          status: 'ACTIVE',
          priceAmount: listing.priceAmount,
          priceCurrency: CURRENCY,
          shippingAmount: listing.shippingAmount,
          dispatchDays: listing.dispatchDays,
          availableStock: listing.stock,
        })
        .onConflictDoNothing();

      const listingRows = await tx
        .select({ id: schema.listings.id })
        .from(schema.listings)
        .where(and(eq(schema.listings.tenantId, tenantId), eq(schema.listings.variantId, variantId)))
        .limit(1);
      const listingId = listingRows[0]?.id;
      if (listingId === undefined) {
        throw new Error(`Demo seed wrote no listing for ${listing.orgSlug} / ${listing.sku}`);
      }

      await tx
        .insert(schema.inventoryItems)
        .values({ tenantId, listingId, warehouseId, onHand: listing.stock, reserved: 0 })
        .onConflictDoNothing();
    });
  }

  return {
    demoOrganisations: DEMO_ORGS.length,
    demoProducts: DEMO_PRODUCTS.length,
    demoVariants: variantCount,
    demoWarehouses: DEMO_WAREHOUSES.length,
    demoListings: DEMO_LISTINGS.length,
  };
}
