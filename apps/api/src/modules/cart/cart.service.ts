import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { type Transaction, schema, withTenant } from '@nexmarket/db';
import { type Money, lineTotal, money } from '@nexmarket/shared';
import { translateDbErrors } from '../../common/db-errors.js';
import { hashGuestToken } from './guest-token.js';

export type CartLine = {
  id: string;
  listingId: string;
  productName: string;
  variantSku: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
  /** ACTIVE, in stock, seller ACTIVE. An unavailable line is shown, not hidden. */
  available: boolean;
  unavailableReason: string | null;
};

export type SellerGroup = {
  sellerId: string;
  sellerSlug: string;
  sellerName: string;
  lines: CartLine[];
  subtotal: Money;
};

export type CartView = {
  id: string;
  currency: string;
  groups: SellerGroup[];
  subtotal: Money;
  itemCount: number;
  hasUnavailableLines: boolean;
};

/** The cart's identity: a signed-in user, or an anonymous browser's token. */
export type CartOwner = { userId: string } | { guestToken: string };

const PLATFORM_CURRENCY = 'BDT';

/**
 * PRD 9.1: "One cart, many sellers", server-authoritative.
 *
 * `carts` and `cart_items` are platform-owned with no row-level security: a
 * cart spans sellers by definition, so there is no tenant to scope it to. The
 * boundary is `user_id` or `token_hash`, and it is applied in `cartFor()` -
 * every other method takes a cart id that has already been resolved from an
 * owner, so no query here can reach a cart the caller does not hold.
 *
 * It opens its own `withTenant` rather than taking one from the request
 * context, because the cart routes are @Public() so that guests can shop, and
 * @Public() routes skip the interceptor entirely - the same pattern
 * CatalogueService uses.
 *
 * **THE CART STORES NO PRICES.** Every amount in a CartView is read from
 * `listings` on the way out, and there is a test asserting the table has no
 * money column. That is what makes price tampering unrepresentable rather than
 * merely rejected: there is no field a client can influence that later becomes
 * money.
 */
@Injectable()
export class CartService {
  async view(owner: CartOwner): Promise<CartView> {
    return this.run(owner, async (tx) => this.render(tx, await this.cartFor(tx, owner)));
  }

  async addItem(owner: CartOwner, listingId: string, quantity: number): Promise<CartView> {
    return this.run(owner, async (tx) => {
      const cartId = await this.cartFor(tx, owner);

      // The listing must be publicly purchasable. This read runs with no
      // tenant, so `public_active_offers` is what decides - a DRAFT or PAUSED
      // offer is simply not there, and a caller cannot add one by guessing its
      // id.
      const listings = await tx
        .select({ id: schema.listings.id })
        .from(schema.listings)
        .where(eq(schema.listings.id, listingId))
        .limit(1);
      if (listings.length === 0) throw new NotFoundException('No such listing');

      await translateDbErrors(
        tx
          .insert(schema.cartItems)
          .values({ cartId, listingId, quantity })
          .onConflictDoUpdate({
            target: [schema.cartItems.cartId, schema.cartItems.listingId],
            // SUMMED, not replaced. "Add to cart" twice means two, which is
            // what every shopper expects and what the merge rule also does.
            set: {
              quantity: sql`${schema.cartItems.quantity} + ${quantity}`,
              updatedAt: new Date(),
            },
          }),
      );

      return this.render(tx, cartId);
    });
  }

  async setQuantity(owner: CartOwner, itemId: string, quantity: number): Promise<CartView> {
    return this.run(owner, async (tx) => {
      const cartId = await this.cartFor(tx, owner);
      const updated = await tx
        .update(schema.cartItems)
        .set({ quantity, updatedAt: new Date() })
        // Both predicates. `eq(itemId)` alone would edit a line in someone
        // else's cart, and report success doing it.
        .where(and(eq(schema.cartItems.id, itemId), eq(schema.cartItems.cartId, cartId)))
        .returning({ id: schema.cartItems.id });
      if (updated.length === 0) throw new NotFoundException('No such cart item');
      return this.render(tx, cartId);
    });
  }

  async removeItem(owner: CartOwner, itemId: string): Promise<CartView> {
    return this.run(owner, async (tx) => {
      const cartId = await this.cartFor(tx, owner);
      const deleted = await tx
        .delete(schema.cartItems)
        .where(and(eq(schema.cartItems.id, itemId), eq(schema.cartItems.cartId, cartId)))
        .returning({ id: schema.cartItems.id });
      if (deleted.length === 0) throw new NotFoundException('No such cart item');
      return this.render(tx, cartId);
    });
  }

  /**
   * PRD 9.1: "Guest cart merged on login (quantity-summed, not overwritten)".
   *
   * The guest cart is marked MERGED rather than deleted, so a double-submitted
   * merge is a no-op instead of a resurrection: the second call finds no ACTIVE
   * guest cart and returns the member cart unchanged.
   */
  async merge(guestToken: string, userId: string): Promise<CartView> {
    return this.run({ userId }, async (tx) => {
      const memberCartId = await this.cartFor(tx, { userId });
      const guestCartId = await this.findActive(tx, { guestToken });
      if (guestCartId === null || guestCartId === memberCartId) {
        return this.render(tx, memberCartId);
      }

      await tx.execute(sql`
        INSERT INTO cart_items (cart_id, listing_id, quantity)
        SELECT ${memberCartId}, listing_id, quantity FROM cart_items WHERE cart_id = ${guestCartId}
        ON CONFLICT (cart_id, listing_id)
        DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = now()
      `);

      await tx
        .update(schema.carts)
        .set({ status: 'MERGED', updatedAt: new Date() })
        .where(eq(schema.carts.id, guestCartId));

      return this.render(tx, memberCartId);
    });
  }

  // ---------------------------------------------------------------- internals
  // These take a transaction so checkout can call them inside ITS transaction:
  // the cart must be read and converted in the same transaction that places the
  // orders, or a cart could be emptied by a concurrent request between the two.

  /** Finds the caller's ACTIVE cart, creating one if needed. */
  async cartFor(tx: Transaction, owner: CartOwner): Promise<string> {
    const existing = await this.findActive(tx, owner);
    if (existing !== null) return existing;

    // Currency is the platform's, never the caller's. A cart whose currency the
    // client chose is a cart that can be made to disagree with its listings.
    const rows = await tx
      .insert(schema.carts)
      .values(
        'userId' in owner
          ? { userId: owner.userId, status: 'ACTIVE', currency: PLATFORM_CURRENCY }
          : {
              tokenHash: hashGuestToken(owner.guestToken),
              status: 'ACTIVE',
              currency: PLATFORM_CURRENCY,
            },
      )
      .returning({ id: schema.carts.id });
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Cart insert returned no row');
    return id;
  }

  async render(tx: Transaction, cartId: string): Promise<CartView> {
    const carts = await tx
      .select({ id: schema.carts.id, currency: schema.carts.currency })
      .from(schema.carts)
      .where(eq(schema.carts.id, cartId))
      .limit(1);
    const cart = carts[0];
    if (cart === undefined) throw new NotFoundException('No such cart');

    /**
     * One query for the whole cart.
     *
     * A LEFT JOIN, not an inner one: a line whose listing has since been paused
     * must still appear, flagged, rather than vanishing between page loads. A
     * cart that silently loses items is a support ticket nobody can reproduce.
     */
    const rows = await tx.execute<CartRow>(sql`
      SELECT ci.id, ci.listing_id, ci.quantity,
             COALESCE(l.sale_price_amount, l.price_amount) AS price_amount,
             l.price_currency AS currency,
             l.available_stock,
             p.name AS product_name,
             v.sku,
             o.id AS seller_id, o.slug AS seller_slug, o.display_name AS seller_name,
             o.status::text AS seller_status
        FROM cart_items ci
        LEFT JOIN listings l ON l.id = ci.listing_id
        LEFT JOIN product_variants v ON v.id = l.variant_id
        LEFT JOIN products p ON p.id = v.product_id
        LEFT JOIN organisations o ON o.id = l.tenant_id
       WHERE ci.cart_id = ${cartId}
       ORDER BY o.display_name NULLS LAST, ci.created_at
    `);

    const groups = new Map<string, SellerGroup>();
    let subtotal = 0;
    let itemCount = 0;
    let hasUnavailable = false;

    for (const row of rows.rows) {
      const reason = unavailableReason(row);
      const unit = money(toNumber(row.price_amount), row.currency ?? cart.currency);
      const total = lineTotal(unit, row.quantity);

      const line: CartLine = {
        id: row.id,
        listingId: row.listing_id,
        productName: row.product_name ?? 'Unavailable product',
        variantSku: row.sku ?? '',
        quantity: row.quantity,
        unitPrice: unit,
        lineTotal: total,
        available: reason === null,
        unavailableReason: reason,
      };

      if (reason === null) {
        subtotal += total.amount;
        itemCount += row.quantity;
      } else {
        hasUnavailable = true;
      }

      const sellerId = row.seller_id ?? 'unavailable';
      const group = groups.get(sellerId) ?? {
        sellerId,
        sellerSlug: row.seller_slug ?? '',
        sellerName: row.seller_name ?? 'Unavailable seller',
        lines: [],
        subtotal: money(0, cart.currency),
      };
      group.lines.push(line);
      if (reason === null) {
        group.subtotal = money(group.subtotal.amount + total.amount, group.subtotal.currency);
      }
      groups.set(sellerId, group);
    }

    return {
      id: cart.id,
      currency: cart.currency,
      groups: [...groups.values()],
      subtotal: money(subtotal, cart.currency),
      itemCount,
      hasUnavailableLines: hasUnavailable,
    };
  }

  /** Called by checkout once the orders are placed. A cart is never reopened. */
  async markConverted(tx: Transaction, cartId: string): Promise<void> {
    await tx
      .update(schema.carts)
      .set({ status: 'CONVERTED', updatedAt: new Date() })
      .where(eq(schema.carts.id, cartId));
  }

  private async findActive(tx: Transaction, owner: CartOwner): Promise<string | null> {
    const rows = await tx
      .select({ id: schema.carts.id })
      .from(schema.carts)
      .where(
        and(
          eq(schema.carts.status, 'ACTIVE'),
          'userId' in owner
            ? eq(schema.carts.userId, owner.userId)
            : eq(schema.carts.tokenHash, hashGuestToken(owner.guestToken)),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  private run<T>(owner: CartOwner, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    // userId is carried into the GUC even though no cart policy reads it, so
    // that anything these transactions touch later - orders, for one - sees the
    // caller rather than an anonymous session.
    return withTenant(
      { tenantId: null, userId: 'userId' in owner ? owner.userId : null, isAdmin: false },
      fn,
    );
  }
}

type CartRow = {
  id: string;
  listing_id: string;
  quantity: number;
  price_amount: string | number | null;
  currency: string | null;
  available_stock: number | null;
  product_name: string | null;
  sku: string | null;
  seller_id: string | null;
  seller_slug: string | null;
  seller_name: string | null;
  seller_status: string | null;
};

/**
 * Why a line cannot be bought, in the order a shopper would care about.
 *
 * `null` means available. Returning a REASON rather than a boolean is what lets
 * the cart page say "this seller is not currently trading" instead of silently
 * dropping a line the shopper deliberately added.
 */
function unavailableReason(row: CartRow): string | null {
  // The LEFT JOIN produced nulls: the listing is no longer publicly visible,
  // which under public_active_offers means archived, paused or draft.
  if (row.price_amount === null) return 'This offer is no longer available';
  if (row.seller_status !== 'ACTIVE') return 'This seller is not currently trading';
  const stock = row.available_stock ?? 0;
  if (stock <= 0) return 'Out of stock';
  if (stock < row.quantity) return `Only ${stock} left`;
  return null;
}

/**
 * A raw tx.execute skips Drizzle's column mapping, and a bigint comes back as a
 * string. `+null` is 0, so an unmapped null would read as a free item.
 */
function toNumber(value: string | number | null): number {
  if (value === null) return 0;
  return typeof value === 'string' ? Number.parseInt(value, 10) : value;
}

export function assertQuantity(quantity: unknown): number {
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
    throw new BadRequestException('quantity must be a positive integer');
  }
  if (quantity > 999) throw new BadRequestException('quantity must not exceed 999');
  return quantity;
}
