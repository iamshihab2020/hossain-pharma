import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type Transaction } from '@nexmarket/db';
import {
  type Money,
  chargeableWeightGrams,
  commissionFor,
  lineTotal,
  money,
  resolveCommissionBps,
  taxFor,
} from '@nexmarket/shared';
import {
  SHIPPING_QUOTE_PROVIDER,
  type ShippingQuoteProvider,
} from '../shipping/shipping-quote.port.js';
import { type QuoteBasis, basisFor } from '../shipping/zone-rate.adapter.js';
import { ServiceabilityService } from '../shipping/serviceability.service.js';
import type { Address } from '../addresses/addresses.service.js';

export type QuoteLine = {
  listingId: string;
  productName: string;
  variantSku: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
  commissionBps: number;
  commission: Money;
};

export type QuoteGroup = {
  sellerId: string;
  sellerSlug: string;
  sellerName: string;
  lines: QuoteLine[];
  subtotal: Money;
  shipping: Money;
  tax: Money;
  commission: Money;
  total: Money;
  /**
   * WHAT PRODUCED THE SHIPPING NUMBER, so the storefront never presents a
   * fallback as a zone quote. Same discipline as the buy box's
   * `BUY_BOX_BASIS` - a number whose basis is invisible is a number nobody can
   * argue with, and shipping is the line buyers argue with most.
   */
  shippingBasis: QuoteBasis;
  /** Chargeable grams for the group; null when a line is unmeasured. */
  chargeableGrams: number | null;
};

export type Quote = {
  cartId: string;
  currency: string;
  groups: QuoteGroup[];
  subtotal: Money;
  shipping: Money;
  tax: Money;
  total: Money;
  /** True if any line sits in a RESTRICTED category. PRD 9.1's age gate. */
  requiresAgeCheck: boolean;
  /**
   * The zone the address resolved to, or null when nothing serves it.
   *
   * Carried on the QUOTE rather than per group because it is a fact about
   * where the buyer is, not about who is selling. Checkout reads `codAllowed`
   * off it to decide whether cash on delivery is offered at all - PRD 9.1's
   * "COD where the zone allows it".
   */
  zone: QuoteZoneView | null;
};

/**
 * The zone as the storefront needs it: no rate card, which is internal.
 *
 * The ID travels because checkout has to confirm a caller-supplied slot belongs
 * to this zone, and because the slots endpoint already exposes ids for the same
 * public geography. What stays internal is the rate card - a seller's landed
 * price is computed from it, and publishing the bands would publish the pricing.
 */
export type QuoteZoneView = {
  id: string;
  code: string;
  name: string;
  areaName: string;
  codAllowed: boolean;
  transitDaysMin: number;
  transitDaysMax: number;
};

/**
 * Turns a cart plus an address into money, per seller group.
 *
 * **Every number here is computed from the database inside the caller's
 * transaction.** Nothing is read from the request. That is the whole of "price
 * tampering rejected" (PRD 11 Phase 4): there is no path by which a client
 * value becomes an order total, so tampering is not rejected so much as
 * unrepresentable. `expectedTotal` on the confirm request is a COMPARISON
 * against this, never an input to it.
 *
 * The quote is computed twice - once for display, once at confirm - and both
 * calls run this code. A quote cached between them would be a price the seller
 * could no longer honour.
 */
@Injectable()
export class QuoteService {
  constructor(
    @Inject(SHIPPING_QUOTE_PROVIDER) private readonly shipping: ShippingQuoteProvider,
    private readonly serviceability: ServiceabilityService,
  ) {}

  async quote(tx: Transaction, cartId: string, address: Address): Promise<Quote> {
    const rows = await tx.execute<QuoteRow>(sql`
      SELECT ci.listing_id, ci.quantity,
             COALESCE(l.sale_price_amount, l.price_amount) AS price_amount,
             l.price_currency AS currency,
             l.available_stock,
             p.name AS product_name,
             v.sku,
             v.weight_grams, v.length_mm, v.width_mm, v.height_mm,
             c.is_restricted,
             c.commission_bps AS category_commission_bps,
             o.id AS seller_id, o.slug AS seller_slug, o.display_name AS seller_name,
             o.status::text AS seller_status,
             o.commission_bps AS seller_commission_bps
        FROM cart_items ci
        JOIN listings l ON l.id = ci.listing_id
        JOIN product_variants v ON v.id = l.variant_id
        JOIN products p ON p.id = v.product_id
        JOIN categories c ON c.id = p.category_id
        JOIN organisations o ON o.id = l.tenant_id
       WHERE ci.cart_id = ${cartId}
       ORDER BY o.display_name, ci.created_at
    `);

    if (rows.rows.length === 0) {
      throw new ConflictException('Your cart is empty');
    }

    const currency = rows.rows[0]?.currency ?? 'BDT';
    const groups = new Map<string, QuoteGroup>();
    let requiresAgeCheck = false;

    for (const row of rows.rows) {
      // Refuse the whole quote rather than silently dropping a line. A checkout
      // that quietly costs less than the cart shown a moment ago is worse than
      // one that says why it stopped.
      if (row.seller_status !== 'ACTIVE') {
        throw new ConflictException(`${row.seller_name} is not currently trading`);
      }
      const stock = row.available_stock ?? 0;
      if (stock < row.quantity) {
        throw new ConflictException(
          `${row.product_name} has only ${stock} left; adjust the quantity to continue`,
        );
      }
      if (row.is_restricted) requiresAgeCheck = true;

      const unit = money(toNumber(row.price_amount), row.currency);
      const total = lineTotal(unit, row.quantity);
      const bps = resolveCommissionBps(row.seller_commission_bps, row.category_commission_bps);

      const line: QuoteLine = {
        listingId: row.listing_id,
        productName: row.product_name,
        variantSku: row.sku,
        quantity: row.quantity,
        unitPrice: unit,
        lineTotal: total,
        commissionBps: bps,
        commission: commissionFor(total, bps),
      };

      const group = groups.get(row.seller_id) ?? {
        sellerId: row.seller_id,
        sellerSlug: row.seller_slug,
        sellerName: row.seller_name,
        lines: [],
        subtotal: money(0, currency),
        shipping: money(0, currency),
        tax: money(0, currency),
        commission: money(0, currency),
        total: money(0, currency),
        shippingBasis: 'flat-shipping' as QuoteBasis,
        chargeableGrams: 0,
      };
      group.lines.push(line);
      group.subtotal = money(group.subtotal.amount + total.amount, currency);
      group.commission = money(group.commission.amount + line.commission.amount, currency);

      /**
       * Chargeable weight accumulates across the group, and ONE unmeasured line
       * poisons the whole group to null.
       *
       * Summing what is known and ignoring the rest would quote a light band
       * for a parcel containing something nobody weighed - an under-charge that
       * looks exactly like a correct quote. Null makes the adapter fall back to
       * the flat rate, which is the honest answer for "we do not know what this
       * weighs".
       */
      group.chargeableGrams = addChargeable(group.chargeableGrams, row);
      groups.set(row.seller_id, group);
    }

    /**
     * ONE zone lookup for the whole cart, before the per-group loop.
     *
     * The zone is a fact about where the buyer is, not about who is selling, so
     * resolving it inside the loop would repeat the same two queries once per
     * seller on the checkout path that PRD 13 budgets at p95 < 500 ms.
     */
    const zone = await this.serviceability.resolve(tx, address.postcode, address.countryCode);

    // Shipping and tax are per GROUP, not per cart: three sellers means three
    // parcels, and a tax computed on the whole cart could not be attributed to
    // the seller who owes it.
    let subtotal = 0;
    let shippingTotal = 0;
    let taxTotal = 0;

    for (const group of groups.values()) {
      const itemCount = group.lines.reduce((acc, l) => acc + l.quantity, 0);
      const request = {
        sellerId: group.sellerId,
        subtotal: group.subtotal,
        itemCount,
        postcode: address.postcode,
        countryCode: address.countryCode,
        zone,
        chargeableGrams: group.chargeableGrams,
      };
      group.shipping = this.shipping.quote(request);
      group.shippingBasis = basisFor(request);
      // Tax is on goods plus shipping, which is the ordinary VAT treatment and
      // the one the seed's BDT rate assumes.
      group.tax = taxFor(
        money(group.subtotal.amount + group.shipping.amount, currency),
        address.countryCode,
      );
      group.total = money(
        group.subtotal.amount + group.shipping.amount + group.tax.amount,
        currency,
      );

      subtotal += group.subtotal.amount;
      shippingTotal += group.shipping.amount;
      taxTotal += group.tax.amount;
    }

    return {
      cartId,
      currency,
      groups: [...groups.values()],
      subtotal: money(subtotal, currency),
      shipping: money(shippingTotal, currency),
      tax: money(taxTotal, currency),
      total: money(subtotal + shippingTotal + taxTotal, currency),
      requiresAgeCheck,
      zone:
        zone === null
          ? null
          : {
              id: zone.id,
              code: zone.code,
              name: zone.name,
              areaName: zone.areaName,
              codAllowed: zone.codAllowed,
              transitDaysMin: zone.transitDaysMin,
              transitDaysMax: zone.transitDaysMax,
            },
    };
  }
}

/**
 * Adds one line's chargeable weight to a running total, propagating null.
 *
 * Multiplied by QUANTITY: three of a thing is three parcels' worth of mass, and
 * quoting one unit's weight for a box of ten is the under-charge this exists to
 * prevent.
 */
function addChargeable(running: number | null, row: QuoteRow): number | null {
  if (running === null) return null;
  if (row.weight_grams === null) return null;

  const dimensions =
    row.length_mm !== null && row.width_mm !== null && row.height_mm !== null
      ? { lengthMm: row.length_mm, widthMm: row.width_mm, heightMm: row.height_mm }
      : null;

  return running + chargeableWeightGrams(row.weight_grams, dimensions) * row.quantity;
}

type QuoteRow = {
  listing_id: string;
  quantity: number;
  price_amount: string | number;
  currency: string;
  available_stock: number | null;
  product_name: string;
  sku: string;
  weight_grams: number | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  is_restricted: boolean;
  category_commission_bps: number | null;
  seller_id: string;
  seller_slug: string;
  seller_name: string;
  seller_status: string;
  seller_commission_bps: number | null;
};

/** A raw tx.execute skips Drizzle's mapping, and bigint arrives as a string. */
function toNumber(value: string | number): number {
  return typeof value === 'string' ? Number.parseInt(value, 10) : value;
}
