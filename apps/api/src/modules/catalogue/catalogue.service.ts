import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { schema, withTenant, type Transaction } from '@nexmarket/db';
import {
  chargeableWeightGrams,
  rankOffers,
  type BuyBox,
  type OfferInput,
} from '@nexmarket/shared';

export type CategoryNode = {
  id: string;
  slug: string;
  name: string;
  path: string;
  isPerishable: boolean;
  isRestricted: boolean;
  children: CategoryNode[];
};

export type ProductSummary = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  fromPrice: { amount: number; currency: string } | null;
  sellerCount: number;
};

export type ProductPage = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  description: string | null;
  category: { slug: string; name: string; path: string; isRestricted: boolean };
  attributes: { key: string; label: string; value: string | number | boolean }[];
  media: { id: string; altText: string | null; position: number }[];
  variants: {
    id: string;
    sku: string;
    name: string;
    /**
     * CHARGEABLE grams - `max(actual, volumetric)` - not the scale weight.
     *
     * On the wire so the page's delivery check can ask for a real rate rather
     * than a zone with no price. Null for a variant nobody has measured, which
     * the check renders as an estimate without a number.
     *
     * The chargeable figure rather than the raw columns because the page has no
     * business doing courier arithmetic, and shipping three numbers it must
     * combine correctly is three chances to combine them differently from the
     * server.
     */
    chargeableGrams: number | null;
    buyBox: PublicBuyBox;
  }[];
};

/** The wire shape. Deliberately narrower than the internal RankedOffer. */
export type PublicBuyBox = {
  basis: BuyBox['basis'];
  otherSellerCount: number;
  winner: PublicOffer | null;
  offers: PublicOffer[];
};

type SellerMap = Map<string, { slug: string; name: string }>;

type OffersForProduct = { byVariant: Map<string, OfferInput[]>; sellers: SellerMap };

export type PublicOffer = {
  listingId: string;
  seller: { id: string; slug: string; displayName: string };
  price: { amount: number; currency: string };
  shipping: { amount: number; currency: string };
  landedPrice: { amount: number; currency: string };
  dispatchDays: number;
  /**
   * A band, not the number.
   *
   * PRD 9.1 asks for "in stock / low stock / out of stock". Publishing an exact
   * count tells a competitor how fast a rival is selling, and nothing on the
   * buyer's side needs more than the band.
   */
  availability: 'IN_STOCK' | 'LOW_STOCK';
  isWinner: boolean;
};

const LOW_STOCK_AT = 5;

/**
 * The public catalogue. Every read here runs with NO tenant context, on
 * purpose: a marketplace product page has to work for someone who is not
 * logged in, and the `public_active_offers` policy in migration 0008 is what
 * makes the offer table visible without one.
 *
 * It opens its own `withTenant` rather than taking one from the request
 * context, because @Public() routes skip the interceptor entirely (plan D-E) -
 * the same pattern AuthService uses for register and login.
 */
@Injectable()
export class CatalogueService {
  private run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant({ tenantId: null, userId: null, isAdmin: false }, fn);
  }

  async categoryTree(): Promise<CategoryNode[]> {
    return this.run(async (tx) => {
      const rows = await tx.select().from(schema.categories).orderBy(asc(schema.categories.path));

      const byId = new Map<string, CategoryNode>();
      for (const row of rows) {
        byId.set(row.id, {
          id: row.id,
          slug: row.slug,
          name: row.name,
          path: row.path,
          isPerishable: row.isPerishable,
          isRestricted: row.isRestricted,
          children: [],
        });
      }

      const roots: CategoryNode[] = [];
      // Ordered by path, so a parent is always seen before its children and one
      // pass is enough - no second lookup and no possibility of an orphan
      // silently disappearing from the tree.
      for (const row of rows) {
        const node = byId.get(row.id);
        if (node === undefined) continue;
        const parent = row.parentId === null ? undefined : byId.get(row.parentId);
        if (parent === undefined) roots.push(node);
        else parent.children.push(node);
      }
      return roots;
    });
  }

  /** PRD 9.1 nested browse. `<@` is the ltree subtree operator, hence the GiST index. */
  async productsInCategory(slug: string): Promise<ProductSummary[]> {
    return this.run(async (tx) => {
      const categories = await tx
        .select({ path: schema.categories.path })
        .from(schema.categories)
        .where(eq(schema.categories.slug, slug))
        .limit(1);
      const category = categories[0];
      if (category === undefined) throw new NotFoundException('No such category');

      const products = await tx
        .select({
          id: schema.products.id,
          slug: schema.products.slug,
          name: schema.products.name,
          brand: schema.products.brand,
        })
        .from(schema.products)
        .innerJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId))
        // A subtree match, so browsing "electronics" includes smartphones. The
        // alternative - listing descendant ids in the application - is a second
        // query that goes stale the moment the tree changes mid-request.
        .where(
          sql`${schema.products.status} = 'ACTIVE' AND ${schema.categories.path} <@ ${category.path}::ltree`,
        )
        .orderBy(asc(schema.products.name));

      if (products.length === 0) return [];
      const offers = await this.offersForProducts(
        tx,
        products.map((p) => p.id),
      );

      return products.map((product) => {
        const eligible = (offers.get(product.id) ?? []).filter((o) => o.availableStock > 0);
        const box = rankOffers(eligible);
        return {
          ...product,
          fromPrice: box.winner === null ? null : box.winner.landedPrice,
          sellerCount: box.offers.length,
        };
      });
    });
  }

  /** PRD 9.1's product page, including the multi-seller offer table. */
  async productPage(slug: string): Promise<ProductPage> {
    return this.run(async (tx) => {
      const rows = await tx
        .select({
          id: schema.products.id,
          slug: schema.products.slug,
          name: schema.products.name,
          brand: schema.products.brand,
          description: schema.products.description,
          categorySlug: schema.categories.slug,
          categoryName: schema.categories.name,
          categoryPath: schema.categories.path,
          categoryRestricted: schema.categories.isRestricted,
        })
        .from(schema.products)
        .innerJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId))
        .where(eq(schema.products.slug, slug))
        .limit(1);
      const product = rows[0];
      // A DRAFT or REJECTED product is not a 403 - to an anonymous reader it
      // simply is not a page. Saying "exists but unpublished" would let anyone
      // enumerate what sellers have proposed.
      if (product === undefined) throw new NotFoundException('No such product');
      const published = await tx
        .select({ status: schema.products.status })
        .from(schema.products)
        .where(eq(schema.products.id, product.id))
        .limit(1);
      if (published[0]?.status !== 'ACTIVE') throw new NotFoundException('No such product');

      // Sequential, NOT Promise.all. These four queries share one transaction,
      // which means one pg client, and a client cannot execute two queries at
      // once - node-postgres queues them today with a deprecation warning and
      // removes the behaviour in pg 9. Concurrency here would also be
      // meaningless: the queries are serialised on the wire either way.
      const attributes = await this.attributes(tx, product.id);
      const media = await tx
        .select()
        .from(schema.productMedia)
        .where(eq(schema.productMedia.productId, product.id))
        .orderBy(asc(schema.productMedia.position));
      const variants = await tx
        .select()
        .from(schema.productVariants)
        .where(eq(schema.productVariants.productId, product.id))
        .orderBy(asc(schema.productVariants.position));
      const offers = await this.offersByVariant(tx, product.id);

      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        description: product.description,
        category: {
          slug: product.categorySlug,
          name: product.categoryName,
          path: product.categoryPath,
          isRestricted: product.categoryRestricted,
        },
        attributes,
        media: media.map((m) => ({ id: m.id, altText: m.altText, position: m.position })),
        variants: variants.map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          name: variant.name,
          chargeableGrams:
            variant.weightGrams === null
              ? null
              : chargeableWeightGrams(
                  variant.weightGrams,
                  variant.lengthMm !== null && variant.widthMm !== null && variant.heightMm !== null
                    ? {
                        lengthMm: variant.lengthMm,
                        widthMm: variant.widthMm,
                        heightMm: variant.heightMm,
                      }
                    : null,
                ),
          buyBox: toPublicBuyBox(rankOffers(offers.byVariant.get(variant.id) ?? []), offers.sellers),
        })),
      };
    });
  }

  // ------------------------------------------------------------------ internals

  private async attributes(tx: Transaction, productId: string): Promise<ProductPage['attributes']> {
    const rows = await tx
      .select({
        key: schema.productAttributes.key,
        label: schema.categoryAttributes.label,
        valueText: schema.productAttributes.valueText,
        valueNumber: schema.productAttributes.valueNumber,
        valueBool: schema.productAttributes.valueBool,
      })
      .from(schema.productAttributes)
      .innerJoin(schema.products, eq(schema.products.id, schema.productAttributes.productId))
      .leftJoin(
        schema.categoryAttributes,
        sql`${schema.categoryAttributes.categoryId} = ${schema.products.categoryId}
            AND ${schema.categoryAttributes.key} = ${schema.productAttributes.key}`,
      )
      .where(eq(schema.productAttributes.productId, productId))
      .orderBy(asc(schema.productAttributes.key));

    return rows.map((row) => ({
      key: row.key,
      // An attribute with no matching category_attributes row still renders,
      // under its raw key. Dropping it would hide data that is in the database.
      label: row.label ?? row.key,
      value: row.valueText ?? row.valueNumber ?? row.valueBool ?? '',
    }));
  }

  private async offersByVariant(tx: Transaction, productId: string): Promise<OffersForProduct> {
    const variants = await tx
      .select({ id: schema.productVariants.id })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, productId));

    const byVariant = new Map<string, OfferInput[]>();
    const sellers: SellerMap = new Map();
    if (variants.length === 0) return { byVariant, sellers };

    const rows = await tx
      .select({
        variantId: schema.listings.variantId,
        listingId: schema.listings.id,
        tenantId: schema.listings.tenantId,
        priceAmount: schema.listings.priceAmount,
        priceCurrency: schema.listings.priceCurrency,
        salePriceAmount: schema.listings.salePriceAmount,
        shippingAmount: schema.listings.shippingAmount,
        dispatchDays: schema.listings.dispatchDays,
        availableStock: schema.listings.availableStock,
        listingStatus: schema.listings.status,
        sellerStatus: schema.organisations.status,
        sellerSlug: schema.organisations.slug,
        sellerName: schema.organisations.displayName,
      })
      .from(schema.listings)
      .innerJoin(schema.organisations, eq(schema.organisations.id, schema.listings.tenantId))
      .where(
        inArray(
          schema.listings.variantId,
          variants.map((v) => v.id),
        ),
      );

    for (const row of rows) {
      const list = byVariant.get(row.variantId) ?? [];
      list.push(toOffer(row));
      byVariant.set(row.variantId, list);
      sellers.set(row.tenantId, { slug: row.sellerSlug, name: row.sellerName });
    }
    return { byVariant, sellers };
  }

  private async offersForProducts(
    tx: Transaction,
    productIds: string[],
  ): Promise<Map<string, OfferInput[]>> {
    const rows = await tx
      .select({
        productId: schema.productVariants.productId,
        variantId: schema.listings.variantId,
        listingId: schema.listings.id,
        tenantId: schema.listings.tenantId,
        priceAmount: schema.listings.priceAmount,
        priceCurrency: schema.listings.priceCurrency,
        salePriceAmount: schema.listings.salePriceAmount,
        shippingAmount: schema.listings.shippingAmount,
        dispatchDays: schema.listings.dispatchDays,
        availableStock: schema.listings.availableStock,
        listingStatus: schema.listings.status,
        sellerStatus: schema.organisations.status,
      })
      .from(schema.listings)
      .innerJoin(schema.productVariants, eq(schema.productVariants.id, schema.listings.variantId))
      .innerJoin(schema.organisations, eq(schema.organisations.id, schema.listings.tenantId))
      .where(inArray(schema.productVariants.productId, productIds));

    const byProduct = new Map<string, OfferInput[]>();
    for (const row of rows) {
      const list = byProduct.get(row.productId) ?? [];
      list.push(toOffer(row));
      byProduct.set(row.productId, list);
    }
    return byProduct;
  }
}

/**
 * Seller display data is threaded through as an argument, never held on the
 * service.
 *
 * A NestJS provider is a singleton, so a field set during one request is
 * visible to every other request in flight - which under concurrent load means
 * a product page can render another page's seller names. Ranking itself stays
 * in @nexmarket/shared and takes only what it ranks on; a display name is not a
 * ranking input.
 */
function toPublicBuyBox(box: BuyBox, sellers: SellerMap): PublicBuyBox {
  const toPublic = (offer: BuyBox['offers'][number]): PublicOffer => {
    const seller = sellers.get(offer.tenantId);
    return {
      listingId: offer.listingId,
      seller: { id: offer.tenantId, slug: seller?.slug ?? '', displayName: seller?.name ?? '' },
      price: offer.price,
      shipping: offer.shipping,
      landedPrice: offer.landedPrice,
      dispatchDays: offer.dispatchDays,
      availability: offer.availableStock <= LOW_STOCK_AT ? 'LOW_STOCK' : 'IN_STOCK',
      isWinner: offer.isWinner,
    };
  };

  return {
    basis: box.basis,
    otherSellerCount: box.otherSellerCount,
    winner: box.winner === null ? null : toPublic(box.winner),
    offers: box.offers.map(toPublic),
  };
}

type OfferRow = {
  listingId: string;
  tenantId: string;
  priceAmount: number;
  priceCurrency: string;
  salePriceAmount: number | null;
  shippingAmount: number;
  dispatchDays: number;
  availableStock: number;
  listingStatus: string;
  sellerStatus: string;
};

function toOffer(row: OfferRow): OfferInput {
  return {
    listingId: row.listingId,
    tenantId: row.tenantId,
    // The sale price is what the buyer pays, so it is what the buy box ranks
    // on. Ranking on the base price would put a seller who discounted below
    // one who did not, which is the opposite of the intended behaviour.
    price: {
      amount: row.salePriceAmount ?? row.priceAmount,
      currency: row.priceCurrency,
    },
    shipping: { amount: row.shippingAmount, currency: row.priceCurrency },
    dispatchDays: row.dispatchDays,
    availableStock: row.availableStock,
    // PRD 8.3's second ranking key. There are no reviews until Phase 7, so it
    // is null for every seller and never breaks a tie today.
    sellerRating: null,
    listingStatus: row.listingStatus,
    sellerStatus: row.sellerStatus,
  };
}
