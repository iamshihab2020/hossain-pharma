import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { type Transaction, schema } from '@nexmarket/db';
import { translateDbErrors } from '../../common/db-errors.js';
import { getRequestContext } from '../../common/request-context.js';
import type { CreateAddressInput, UpdateAddressInput } from './dto.js';

export type Address = {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  district: string;
  postcode: string;
  countryCode: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
  createdAt: Date;
};

/**
 * The buyer's address book.
 *
 * `addresses` is platform-owned with no row-level security, because a buyer is
 * not a tenant (PRD 6.2). **`ctx.userId` is therefore the only boundary**, and
 * it appears in EVERY method rather than in a helper somebody could forget -
 * the same rule `saved_searches` follows, and for the same reason.
 *
 * A miss is a 404, never a 403: telling a caller that an address exists but
 * belongs to someone else is itself the leak.
 */
@Injectable()
export class AddressesService {
  async list(): Promise<Address[]> {
    const ctx = this.user();
    const rows = await ctx.tx
      .select()
      .from(schema.addresses)
      .where(eq(schema.addresses.userId, ctx.userId))
      .orderBy(desc(schema.addresses.isDefaultShipping), desc(schema.addresses.createdAt));
    return rows.map(toAddress);
  }

  async get(id: string): Promise<Address> {
    const ctx = this.user();
    const rows = await ctx.tx
      .select()
      .from(schema.addresses)
      // Both predicates, always. `eq(id)` alone would return another user's row.
      .where(and(eq(schema.addresses.id, id), eq(schema.addresses.userId, ctx.userId)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) throw new NotFoundException('No such address');
    return toAddress(row);
  }

  async create(input: CreateAddressInput): Promise<Address> {
    const ctx = this.user();
    return translateDbErrors(
      (async () => {
        const first = await this.isFirstAddress(ctx.tx, ctx.userId);
        // The first address a buyer saves is their default, because a checkout
        // that asks someone to choose between one option is friction with no
        // decision in it.
        const shipping = input.isDefaultShipping ?? first;
        const billing = input.isDefaultBilling ?? first;

        if (shipping) await this.clearDefault(ctx.tx, ctx.userId, 'shipping');
        if (billing) await this.clearDefault(ctx.tx, ctx.userId, 'billing');

        const rows = await ctx.tx
          .insert(schema.addresses)
          .values({
            userId: ctx.userId,
            label: input.label ?? null,
            recipientName: input.recipientName,
            phone: input.phone,
            line1: input.line1,
            line2: input.line2 ?? null,
            city: input.city,
            district: input.district,
            postcode: input.postcode,
            countryCode: input.countryCode,
            isDefaultShipping: shipping,
            isDefaultBilling: billing,
          })
          .returning();
        const row = rows[0];
        if (row === undefined) throw new Error('Address insert returned no row');
        return toAddress(row);
      })(),
    );
  }

  async update(id: string, input: UpdateAddressInput): Promise<Address> {
    const ctx = this.user();
    await this.get(id); // 404s before any write if it is not theirs.

    return translateDbErrors(
      (async () => {
        if (input.isDefaultShipping === true) {
          await this.clearDefault(ctx.tx, ctx.userId, 'shipping');
        }
        if (input.isDefaultBilling === true) {
          await this.clearDefault(ctx.tx, ctx.userId, 'billing');
        }

        await ctx.tx
          .update(schema.addresses)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(schema.addresses.id, id), eq(schema.addresses.userId, ctx.userId)));
        return this.get(id);
      })(),
    );
  }

  async remove(id: string): Promise<void> {
    const ctx = this.user();
    const deleted = await ctx.tx
      .delete(schema.addresses)
      .where(and(eq(schema.addresses.id, id), eq(schema.addresses.userId, ctx.userId)))
      .returning({ id: schema.addresses.id });
    // Deleting by id alone would happily remove another user's address and
    // report success. The row count is the check.
    if (deleted.length === 0) throw new NotFoundException('No such address');
  }

  /**
   * Resolves the address a checkout will ship to, for THIS user.
   *
   * Checkout calls this rather than reading `addresses` itself, so the
   * ownership check exists once.
   */
  async forCheckout(addressId: string): Promise<Address> {
    return this.get(addressId);
  }

  private async isFirstAddress(tx: Transaction, userId: string): Promise<boolean> {
    const rows = await tx
      .select({ id: schema.addresses.id })
      .from(schema.addresses)
      .where(eq(schema.addresses.userId, userId))
      .limit(1);
    return rows.length === 0;
  }

  private async clearDefault(
    tx: Transaction,
    userId: string,
    which: 'shipping' | 'billing',
  ): Promise<void> {
    const column =
      which === 'shipping' ? schema.addresses.isDefaultShipping : schema.addresses.isDefaultBilling;
    await tx
      .update(schema.addresses)
      .set(which === 'shipping' ? { isDefaultShipping: false } : { isDefaultBilling: false })
      .where(and(eq(schema.addresses.userId, userId), eq(column, true)));
  }

  /** Signed-in only: the global AuthGuard has already refused anonymous callers. */
  private user(): { tx: Transaction; userId: string } {
    const ctx = getRequestContext();
    if (ctx.userId === null) {
      throw new NotFoundException('No such address');
    }
    return { tx: ctx.tx, userId: ctx.userId };
  }
}

function toAddress(row: typeof schema.addresses.$inferSelect): Address {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipientName,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    district: row.district,
    postcode: row.postcode,
    countryCode: row.countryCode,
    isDefaultShipping: row.isDefaultShipping,
    isDefaultBilling: row.isDefaultBilling,
    createdAt: row.createdAt,
  };
}
