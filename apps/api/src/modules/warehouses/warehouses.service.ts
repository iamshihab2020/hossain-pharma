import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, ne, sql } from 'drizzle-orm';
import { schema } from '@nexmarket/db';
import { getRequestContext } from '../../common/request-context.js';

export type WarehouseView = {
  id: string;
  name: string;
  addressLine: string;
  city: string;
  district: string;
  postcode: string;
  countryCode: string;
  contactPhone: string;
  isDefault: boolean;
  isPickupPoint: boolean;
  priority: number;
  /** Distinct listings holding stock here, and total units on hand. */
  listingCount: number;
  unitsOnHand: number;
};

export type WarehouseInput = {
  name: string;
  addressLine: string;
  city: string;
  district: string;
  postcode: string;
  countryCode?: string;
  contactPhone: string;
  isDefault?: boolean;
  isPickupPoint?: boolean;
  priority?: number;
};

/**
 * A seller's buildings.
 *
 * TENANT-OWNED and read through ordinary RLS - no escape, no admin bypass. A
 * seller managing their own warehouses is the plainest possible tenant-scoped
 * operation, which is worth saying because almost everything else Phase 6
 * touches is not.
 *
 * PRD 9.2's onboarding step 5 asked for "at least one pickup location with
 * pincode" back in Phase 1 and got a name and a pincode. Phase 6 gives it an
 * address, because Phase 6 is where a parcel actually leaves the building.
 */
@Injectable()
export class WarehousesService {
  async list(): Promise<WarehouseView[]> {
    const { tx } = getRequestContext();

    /**
     * The stock summary is a SEPARATE grouped query, not a correlated subquery
     * in the SELECT list.
     *
     * ADR 0010: Drizzle renders column references inside an `sql` template in
     * the SELECT list WITHOUT table qualification, so
     * `WHERE ${inventoryItems.warehouseId} = ${warehouses.id}` becomes
     * `WHERE "warehouse_id" = "id"` - a table compared to itself, always false,
     * no error. It has cost this codebase an afternoon twice.
     */
    const rows = await tx
      .select()
      .from(schema.warehouses)
      .orderBy(asc(schema.warehouses.priority), asc(schema.warehouses.name));

    const stock = await tx
      .select({
        warehouseId: schema.inventoryItems.warehouseId,
        listingCount: sql<number>`count(*)::int`,
        unitsOnHand: sql<number>`coalesce(sum(${schema.inventoryItems.onHand}), 0)::int`,
      })
      .from(schema.inventoryItems)
      .groupBy(schema.inventoryItems.warehouseId);

    const byWarehouse = new Map(stock.map((row) => [row.warehouseId, row]));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      addressLine: row.addressLine,
      city: row.city,
      district: row.district,
      postcode: row.pincode,
      countryCode: row.countryCode,
      contactPhone: row.contactPhone,
      isDefault: row.isDefault,
      isPickupPoint: row.isPickupPoint,
      priority: row.priority,
      listingCount: byWarehouse.get(row.id)?.listingCount ?? 0,
      unitsOnHand: byWarehouse.get(row.id)?.unitsOnHand ?? 0,
    }));
  }

  async create(input: WarehouseInput): Promise<WarehouseView> {
    const { tx, tenantId } = getRequestContext();
    if (tenantId === null) throw new BadRequestException('Choose an organisation first');

    assertValid(input);

    const [created] = await tx
      .insert(schema.warehouses)
      .values({
        tenantId,
        name: input.name.trim(),
        addressLine: input.addressLine.trim(),
        city: input.city.trim(),
        district: input.district.trim(),
        pincode: input.postcode.trim(),
        countryCode: (input.countryCode ?? 'BD').toUpperCase(),
        contactPhone: input.contactPhone.trim(),
        isPickupPoint: input.isPickupPoint ?? false,
        priority: input.priority ?? 0,
        isDefault: input.isDefault ?? false,
      })
      .returning({ id: schema.warehouses.id })
      .onConflictDoNothing();

    if (created === undefined) {
      throw new ConflictException('You already have a warehouse with that name');
    }

    if (input.isDefault === true) await this.clearOtherDefaults(created.id);

    return this.one(created.id);
  }

  async update(id: string, input: Partial<WarehouseInput>): Promise<WarehouseView> {
    const { tx } = getRequestContext();
    await this.one(id);

    if (Object.keys(input).length === 0) return this.one(id);
    assertValid(input, { partial: true });

    await tx
      .update(schema.warehouses)
      .set({
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.addressLine === undefined ? {} : { addressLine: input.addressLine.trim() }),
        ...(input.city === undefined ? {} : { city: input.city.trim() }),
        ...(input.district === undefined ? {} : { district: input.district.trim() }),
        ...(input.postcode === undefined ? {} : { pincode: input.postcode.trim() }),
        ...(input.countryCode === undefined
          ? {}
          : { countryCode: input.countryCode.toUpperCase() }),
        ...(input.contactPhone === undefined
          ? {}
          : { contactPhone: input.contactPhone.trim() }),
        ...(input.isPickupPoint === undefined ? {} : { isPickupPoint: input.isPickupPoint }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
      })
      .where(eq(schema.warehouses.id, id));

    if (input.isDefault === true) await this.clearOtherDefaults(id);

    return this.one(id);
  }

  async one(id: string): Promise<WarehouseView> {
    const all = await this.list();
    const found = all.find((warehouse) => warehouse.id === id);
    // A 404 rather than a 403: under RLS a warehouse that is not yours does not
    // exist, and "forbidden" would confirm that it does.
    if (found === undefined) throw new NotFoundException('No such warehouse');
    return found;
  }

  /**
   * Deletes a warehouse, but only an empty one.
   *
   * `inventory_items` cascades from `warehouses`, so an unguarded delete would
   * silently destroy the stock records for every listing held here - and
   * `listings.available_stock` is a denormalisation of exactly those rows, so
   * the catalogue would go on advertising units that no longer have a home.
   * Refusing is the honest answer; moving the stock is the seller's decision.
   */
  async remove(id: string): Promise<void> {
    const { tx } = getRequestContext();
    const warehouse = await this.one(id);

    if (warehouse.unitsOnHand > 0 || warehouse.listingCount > 0) {
      throw new ConflictException({
        code: 'WAREHOUSE_NOT_EMPTY',
        message: `${warehouse.name} still holds stock. Move it before closing this location.`,
      });
    }

    await tx.delete(schema.warehouses).where(eq(schema.warehouses.id, id));
  }

  /**
   * Exactly one default, maintained by clearing the others in the SAME
   * transaction.
   *
   * The schema deliberately has no partial unique index for this: enforcing it
   * there would make the update a two-statement dance with an intermediate
   * state that violates the constraint. The Phase 2 comment on `is_default`
   * says so, and this is the writer it was anticipating.
   */
  private async clearOtherDefaults(keepId: string): Promise<void> {
    const { tx } = getRequestContext();
    await tx
      .update(schema.warehouses)
      .set({ isDefault: false })
      .where(ne(schema.warehouses.id, keepId));
  }
}

function assertValid(input: Partial<WarehouseInput>, options: { partial?: boolean } = {}): void {
  const required: (keyof WarehouseInput)[] = options.partial
    ? []
    : ['name', 'addressLine', 'city', 'district', 'postcode', 'contactPhone'];

  for (const field of required) {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException(`${label(field)} is required`);
    }
  }

  if (input.postcode !== undefined && !/^[A-Za-z0-9 ]{3,12}$/.test(input.postcode.trim())) {
    throw new BadRequestException('That is not a postcode');
  }
  if (input.priority !== undefined && !Number.isInteger(input.priority)) {
    throw new BadRequestException('Priority must be a whole number');
  }
  if (input.countryCode !== undefined && !/^[A-Za-z]{2}$/.test(input.countryCode)) {
    throw new BadRequestException('Country must be a two-letter code');
  }
}

/** Field names as the seller sees them on the form, not as the column is named. */
function label(field: keyof WarehouseInput): string {
  const labels: Partial<Record<keyof WarehouseInput, string>> = {
    name: 'A name',
    addressLine: 'A street address',
    city: 'A city',
    district: 'A district',
    postcode: 'A postcode',
    contactPhone: 'A contact phone number',
  };
  return labels[field] ?? field;
}
