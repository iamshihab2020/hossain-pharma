import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';
import { makeWithTenant } from '../tenant-context.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * THE PRD 11 PHASE 2 ACCEPTANCE FIXTURE.
 *
 * "Two sellers list the same product at different prices; the product page
 * shows both with a correct buy-box winner."
 *
 * acme-electronics and northwind-home both offer AUR-X1-128-VIO, and the
 * numbers are chosen so the answer is not the obvious one:
 *
 *   northwind  38,500.00 item + 120.00 shipping = 38,620.00 landed
 *   acme       38,600.00 item +   0.00 shipping = 38,600.00 landed  <- winner
 *
 * The seller with the HIGHER sticker price wins on landed price. A fixture
 * where the cheaper item also wins would pass against a buy box that ignored
 * shipping entirely, which is exactly the bug worth catching.
 *
 * Amounts are integer minor units (paisa). 38,600.00 BDT is 3_860_000.
 */
const WAREHOUSES = [
  { orgSlug: 'acme-electronics', name: 'Dhaka Main', pincode: '1207', isDefault: true },
  { orgSlug: 'northwind-home', name: 'Chattogram Depot', pincode: '4000', isDefault: true },
  { orgSlug: 'meridian-fashion', name: 'Gulshan Studio', pincode: '1212', isDefault: true },
] as const;

const LISTINGS = [
  {
    orgSlug: 'acme-electronics',
    sku: 'AUR-X1-128-VIO',
    priceAmount: 3_860_000,
    shippingAmount: 0,
    dispatchDays: 1,
    stock: 12,
    warehouse: 'Dhaka Main',
  },
  {
    orgSlug: 'northwind-home',
    sku: 'AUR-X1-128-VIO',
    priceAmount: 3_850_000,
    shippingAmount: 12_000,
    dispatchDays: 2,
    stock: 5,
    warehouse: 'Chattogram Depot',
  },
  // A second variant of the same product, offered by one seller only, so the
  // "one offer, no competition" path has a row too.
  {
    orgSlug: 'acme-electronics',
    sku: 'AUR-X1-256-BLK',
    priceAmount: 4_450_000,
    shippingAmount: 0,
    dispatchDays: 1,
    stock: 3,
    warehouse: 'Dhaka Main',
  },
  {
    orgSlug: 'meridian-fashion',
    sku: 'MER-TOTE-OS',
    priceAmount: 145_000,
    shippingAmount: 8_000,
    dispatchDays: 3,
    stock: 40,
    warehouse: 'Gulshan Studio',
  },
] as const;

const CURRENCY = 'BDT';

/**
 * Every write here goes through withTenant, for the reason spelled out in
 * org-members.ts: listings, warehouses and inventory_items are FORCE RLS and
 * the seed connects as nexmarket_app (NOBYPASSRLS), so a plain insert writes
 * ZERO rows and throws nothing.
 */
export async function seedListings(db: Db): Promise<{ warehouses: number; listings: number }> {
  const withTenant = makeWithTenant(db);

  const orgs = await db
    .select({ id: schema.organisations.id, slug: schema.organisations.slug })
    .from(schema.organisations);
  const orgBySlug = new Map(orgs.map((o) => [o.slug, o.id]));

  const variants = await db
    .select({ id: schema.productVariants.id, sku: schema.productVariants.sku })
    .from(schema.productVariants);
  const variantBySku = new Map(variants.map((v) => [v.sku, v.id]));

  for (const warehouse of WAREHOUSES) {
    const tenantId = orgBySlug.get(warehouse.orgSlug);
    if (tenantId === undefined) {
      throw new Error(`Seed inconsistency: no organisation "${warehouse.orgSlug}"`);
    }
    await withTenant({ tenantId, userId: null, isAdmin: false }, async (tx) => {
      await tx
        .insert(schema.warehouses)
        .values({
          tenantId,
          name: warehouse.name,
          pincode: warehouse.pincode,
          isDefault: warehouse.isDefault,
        })
        .onConflictDoNothing();
    });
  }

  for (const listing of LISTINGS) {
    const tenantId = orgBySlug.get(listing.orgSlug);
    const variantId = variantBySku.get(listing.sku);
    if (tenantId === undefined || variantId === undefined) {
      throw new Error(
        `Seed inconsistency: no organisation "${listing.orgSlug}" or variant "${listing.sku}"`,
      );
    }

    await withTenant({ tenantId, userId: null, isAdmin: false }, async (tx) => {
      const warehouseRows = await tx
        .select({ id: schema.warehouses.id })
        .from(schema.warehouses)
        .where(eq(schema.warehouses.name, listing.warehouse))
        .limit(1);
      const warehouseId = warehouseRows[0]?.id;
      if (warehouseId === undefined) {
        throw new Error(`Seed inconsistency: no warehouse "${listing.warehouse}"`);
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
          // Kept in step with inventory_items below, by hand here because the
          // seed does not go through InventoryService. The seed test asserts
          // the two agree, which is what makes that safe to write twice.
          availableStock: listing.stock,
        })
        .onConflictDoNothing();

      const listingRows = await tx
        .select({ id: schema.listings.id })
        .from(schema.listings)
        .where(
          and(eq(schema.listings.tenantId, tenantId), eq(schema.listings.variantId, variantId)),
        )
        .limit(1);
      const listingId = listingRows[0]?.id;
      if (listingId === undefined) {
        // Reached only if RLS refused the insert, which is the failure this
        // whole module is shaped to make loud rather than silent.
        throw new Error(`Seed wrote no listing for ${listing.orgSlug} / ${listing.sku}`);
      }

      await tx
        .insert(schema.inventoryItems)
        .values({ tenantId, listingId, warehouseId, onHand: listing.stock, reserved: 0 })
        .onConflictDoNothing();
    });
  }

  return { warehouses: WAREHOUSES.length, listings: LISTINGS.length };
}
