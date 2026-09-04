import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { schema, type Transaction } from '@nexmarket/db';
import { getRequestContext } from '../../common/request-context.js';
import { translateDbErrors } from '../../common/db-errors.js';
import { SearchIndexService } from '../search/search-index.service.js';
import { decodeCursor, toPage, type Page } from '../../common/pagination.js';
import {
  assertTransition,
  publishTarget,
  type ListingStatus,
} from './lifecycle.js';
import type {
  CreateListingInput,
  CreateWarehouseInput,
  SetInventoryInput,
  UpdateListingInput,
} from './dto.js';

export type Warehouse = {
  id: string;
  name: string;
  pincode: string;
  isDefault: boolean;
  createdAt: Date;
};

export type Listing = {
  id: string;
  tenantId: string;
  variantId: string;
  sku: string;
  productName: string;
  status: ListingStatus;
  condition: string;
  price: { amount: number; currency: string };
  salePriceAmount: number | null;
  shippingAmount: number;
  dispatchDays: number;
  availableStock: number;
  createdAt: Date;
};

@Injectable()
export class ListingsService {
  /**
   * Every write below that can change what a buyer would FIND reindexes the
   * product it touched, in the same transaction. The list is finite and the
   * drift test in search.e2e is what proves it is complete - a hook added to
   * this class without a reindex shows up there as a document that disagrees
   * with the view.
   */
  constructor(private readonly searchIndex: SearchIndexService) {}

  // ---------------------------------------------------------------- warehouses

  async createWarehouse(input: CreateWarehouseInput): Promise<Warehouse> {
    const ctx = this.tenant();

    const inserted = await ctx.tx
      .insert(schema.warehouses)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        pincode: input.pincode,
        isDefault: input.isDefault ?? false,
      })
      .onConflictDoNothing()
      .returning();
    const warehouse = inserted[0];
    if (warehouse === undefined) throw new ConflictException('A warehouse with that name exists');

    // Exactly one default, maintained here rather than by a partial unique
    // index: clearing the others and setting this one has to be a single
    // transaction, and an index would reject the intermediate state where two
    // rows are briefly true.
    if (warehouse.isDefault) {
      await ctx.tx
        .update(schema.warehouses)
        .set({ isDefault: false })
        .where(sql`${schema.warehouses.id} <> ${warehouse.id}`);
    }
    return toWarehouse(warehouse);
  }

  async listWarehouses(): Promise<Warehouse[]> {
    const ctx = this.tenant();
    // No WHERE on tenant_id. RLS is the boundary; a filter here would hide a
    // broken policy rather than let the test that exists for it fail.
    const rows = await ctx.tx.select().from(schema.warehouses).orderBy(schema.warehouses.name);
    return rows.map(toWarehouse);
  }

  // ------------------------------------------------------------------ listings

  async create(input: CreateListingInput): Promise<Listing> {
    const ctx = this.tenant();

    // The variant is platform-owned and has no RLS, so this read succeeds for
    // any seller - which is the point of PRD 8.3. What it must NOT do is let a
    // seller list against a product nobody has approved.
    const variant = await this.variant(ctx.tx, input.variantId);
    if (variant.productStatus !== 'ACTIVE') {
      throw new ConflictException('That product is not published');
    }

    const inserted = await translateDbErrors(
      ctx.tx
      .insert(schema.listings)
      .values({
        tenantId: ctx.tenantId,
        variantId: input.variantId,
        status: 'DRAFT',
        priceAmount: input.priceAmount,
        priceCurrency: input.priceCurrency,
        shippingAmount: input.shippingAmount ?? 0,
        dispatchDays: input.dispatchDays ?? 1,
        condition: input.condition ?? 'NEW',
      })
      .onConflictDoNothing()
      .returning({ id: schema.listings.id }),
    );
    const row = inserted[0];
    // The unique (tenant_id, variant_id) index. Without it a seller lists the
    // same thing twice at two prices and competes with themselves in their own
    // buy box.
    if (row === undefined) throw new ConflictException('You already have an offer on that variant');

    // A DRAFT listing is not eligible, so this writes no price - but it keeps
    // every path uniform, and "which mutations need indexing" is a question
    // nobody should have to answer at each call site.
    await this.searchIndex.reindexForListing(ctx.tx, row.id);
    return this.get(row.id);
  }

  async get(listingId: string): Promise<Listing> {
    const ctx = this.tenant();
    const rows = await this.selectListings(ctx.tx, eq(schema.listings.id, listingId));
    const listing = rows[0];
    // Under RLS a listing belonging to another seller is simply not there, so
    // this 404 is the same answer for "does not exist" and "not yours" - which
    // is the correct answer, because the alternative tells a competitor that a
    // given id is real.
    if (listing === undefined) throw new NotFoundException('No such listing');
    return listing;
  }

  async list(query: { cursor?: string; limit: number; status?: ListingStatus }): Promise<Page<Listing>> {
    const ctx = this.tenant();

    const conditions: SQL[] = [];
    if (query.status !== undefined) conditions.push(eq(schema.listings.status, query.status));
    if (query.cursor !== undefined && query.cursor !== '') {
      const cursor = decodeCursor(query.cursor);
      conditions.push(
        sql`(${schema.listings.createdAt}, ${schema.listings.id}) < (${new Date(cursor.createdAt)}, ${cursor.id}::uuid)`,
      );
    }

    const rows = await this.selectListings(
      ctx.tx,
      conditions.length === 0 ? undefined : and(...conditions),
      query.limit + 1,
    );
    return toPage(rows, query.limit);
  }

  async update(listingId: string, input: UpdateListingInput): Promise<Listing> {
    const ctx = this.tenant();
    const current = await this.get(listingId);
    if (current.status === 'ARCHIVED') {
      throw new ConflictException('An archived listing cannot be edited');
    }

    await translateDbErrors(
      ctx.tx
        .update(schema.listings)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(schema.listings.id, listingId)),
    );
    await this.searchIndex.reindexForListing(ctx.tx, listingId);
    return this.get(listingId);
  }

  /**
   * Sets absolute stock at one warehouse, then recomputes the listing summary.
   *
   * Absolute, not a delta: a delta API over HTTP has no idempotency, so a
   * retried request after a timeout silently doubles the adjustment. "Set it to
   * 12" survives being sent twice.
   */
  async setInventory(listingId: string, input: SetInventoryInput): Promise<Listing> {
    const ctx = this.tenant();
    await this.get(listingId); // 404s if it is not this tenant's

    const warehouses = await ctx.tx
      .select({ id: schema.warehouses.id })
      .from(schema.warehouses)
      .where(eq(schema.warehouses.id, input.warehouseId))
      .limit(1);
    // Under RLS another tenant's warehouse is invisible, so this covers both
    // "no such warehouse" and "not yours".
    if (warehouses[0] === undefined) throw new BadRequestException('No such warehouse');

    await translateDbErrors(
      ctx.tx
      .insert(schema.inventoryItems)
      .values({
        tenantId: ctx.tenantId,
        listingId,
        warehouseId: input.warehouseId,
        onHand: input.onHand,
        lowStockThreshold: input.lowStockThreshold ?? 0,
      })
      .onConflictDoUpdate({
        target: [schema.inventoryItems.listingId, schema.inventoryItems.warehouseId],
        set: {
          onHand: input.onHand,
          lowStockThreshold: input.lowStockThreshold ?? 0,
          updatedAt: new Date(),
        },
      }),
    );

    await this.recomputeAvailableStock(ctx.tx, listingId);
    // Stock is part of eligibility, so a stock change can add a product to the
    // index or take it out of it.
    await this.searchIndex.reindexForListing(ctx.tx, listingId);
    return this.get(listingId);
  }

  /**
   * THE ONLY WRITER of `listings.available_stock`.
   *
   * That column is a denormalisation the public product page depends on: an
   * anonymous reader cannot see inventory_items, which are tenant-isolated, so
   * the summary is the only stock figure that reaches the buy box.
   *
   * It runs in the SAME transaction as the inventory write it summarises, so
   * the two cannot diverge across a failure. A seed test and an API test both
   * assert they agree.
   */
  private async recomputeAvailableStock(tx: Transaction, listingId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE listings SET available_stock = COALESCE((
        SELECT sum(on_hand - reserved)::int FROM inventory_items WHERE listing_id = ${listingId}
      ), 0), updated_at = now()
      WHERE id = ${listingId}
    `);
  }

  // ----------------------------------------------------------------- lifecycle

  /** PRD 9.2 and plan P-C: a RESTRICTED category routes to review instead of live. */
  async publish(listingId: string): Promise<Listing> {
    const ctx = this.tenant();
    const current = await this.get(listingId);

    if (current.availableStock <= 0) {
      // An ACTIVE listing with no stock is ineligible for the buy box anyway,
      // so publishing it produces an offer nobody can see. Refusing says why.
      throw new ConflictException('Add stock before publishing');
    }

    const variant = await this.variant(ctx.tx, current.variantId);
    const target = publishTarget(variant.categoryIsRestricted);
    assertTransition(current.status, target);

    await ctx.tx
      .update(schema.listings)
      .set({ status: target, updatedAt: new Date() })
      .where(eq(schema.listings.id, listingId));
    await this.searchIndex.reindexForListing(ctx.tx, listingId);
    return this.get(listingId);
  }

  async transition(listingId: string, to: ListingStatus): Promise<Listing> {
    const ctx = this.tenant();
    const current = await this.get(listingId);
    assertTransition(current.status, to);
    await ctx.tx
      .update(schema.listings)
      .set({ status: to, updatedAt: new Date() })
      .where(eq(schema.listings.id, listingId));
    await this.searchIndex.reindexForListing(ctx.tx, listingId);
    return this.get(listingId);
  }

  // ------------------------------------------------------------------ internals

  private tenant(): ReturnType<typeof getRequestContext> & { tenantId: string } {
    const ctx = getRequestContext();
    if (ctx.tenantId === null) {
      throw new BadRequestException('Select an organisation with the x-tenant-id header');
    }
    return { ...ctx, tenantId: ctx.tenantId };
  }

  private async variant(
    tx: Transaction,
    variantId: string,
  ): Promise<{ productStatus: string; categoryIsRestricted: boolean }> {
    const rows = await tx
      .select({
        productStatus: schema.products.status,
        categoryIsRestricted: schema.categories.isRestricted,
      })
      .from(schema.productVariants)
      .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
      .innerJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId))
      .where(eq(schema.productVariants.id, variantId))
      .limit(1);
    const variant = rows[0];
    if (variant === undefined) throw new BadRequestException('No such product variant');
    return variant;
  }

  private async selectListings(
    tx: Transaction,
    where: SQL | undefined,
    limit?: number,
  ): Promise<Listing[]> {
    const query = tx
      .select({
        id: schema.listings.id,
        tenantId: schema.listings.tenantId,
        variantId: schema.listings.variantId,
        sku: schema.productVariants.sku,
        productName: schema.products.name,
        status: schema.listings.status,
        condition: schema.listings.condition,
        priceAmount: schema.listings.priceAmount,
        priceCurrency: schema.listings.priceCurrency,
        salePriceAmount: schema.listings.salePriceAmount,
        shippingAmount: schema.listings.shippingAmount,
        dispatchDays: schema.listings.dispatchDays,
        availableStock: schema.listings.availableStock,
        createdAt: schema.listings.createdAt,
      })
      .from(schema.listings)
      .innerJoin(schema.productVariants, eq(schema.productVariants.id, schema.listings.variantId))
      .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
      .where(where)
      .orderBy(desc(schema.listings.createdAt), desc(schema.listings.id));

    const rows = limit === undefined ? await query : await query.limit(limit);
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      variantId: row.variantId,
      sku: row.sku,
      productName: row.productName,
      status: row.status,
      condition: row.condition,
      price: { amount: row.priceAmount, currency: row.priceCurrency },
      salePriceAmount: row.salePriceAmount,
      shippingAmount: row.shippingAmount,
      dispatchDays: row.dispatchDays,
      availableStock: row.availableStock,
      createdAt: row.createdAt,
    }));
  }
}

function toWarehouse(row: typeof schema.warehouses.$inferSelect): Warehouse {
  return {
    id: row.id,
    name: row.name,
    pincode: row.pincode,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
  };
}
