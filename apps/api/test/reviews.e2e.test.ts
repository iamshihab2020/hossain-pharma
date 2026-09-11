import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { ratingDrift, schema, upsertSearchDocument, withTenant } from '@nexmarket/db';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';

/**
 * PRD 11 Phase 7's three acceptance criteria, over HTTP:
 *
 *   1. Only delivered purchases can review.
 *   2. Aggregates recompute correctly on edit/delete.
 *   3. Moderation removes content from all surfaces.
 *
 * Plus the thing Phase 2 left unfinished and this phase finally completes: the
 * buy box has ranked on `sellerRating` since PRD 8.3 was written and has been
 * handed null for every seller ever since. There is a test here that makes two
 * identical offers differ only by their sellers' ratings and checks which one
 * wins.
 *
 * TWO SELLERS ON ONE PRODUCT, which is the shape the rest of the file needs:
 * "moderation removes content from all surfaces" is only interesting when one
 * of the surfaces is a ranking between competitors, and a single seller cannot
 * demonstrate a tiebreak.
 *
 * Its own fixture, like every other e2e file here. Reviews mutate aggregates
 * that the catalogue reads, and three files asserting against one mutable seed
 * is how this suite broke three times in Phase 3.
 */
let app: NestFastifyApplication;

const NS = `reviews-${randomUUID().slice(0, 8)}`;
const PASSWORD = 'reviews-password-1';

type Seller = { orgId: string; listingId: string; token: string };

let productId = '';
let productSlug = '';
let alpha: Seller;
let beta: Seller;
let adminToken = '';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  await buildFixture();
}, 180_000);

afterAll(async () => {
  await app?.close();
});

// ------------------------------------------------------------------ criterion 1

describe('only delivered purchases can review', () => {
  it('takes a review of a line the buyer bought and had delivered', async () => {
    const purchase = await delivered('happy', alpha);

    const res = await asUser(purchase.token, 'POST', '/me/reviews', {
      orderItemId: purchase.orderItemId,
      rating: 5,
      title: 'Exactly as described',
      body: 'Arrived in two days.',
    });

    expect(res.statusCode).toBe(201);
    const review = json<{ rating: number; productId: string; authorName: string }>(res);
    expect(review.rating).toBe(5);
    // The PRODUCT is derived from the order line, never taken from the body -
    // a caller naming both could review one thing on the strength of another.
    expect(review.productId).toBe(productId);
  });

  it('REFUSES a line that has not been delivered yet', async () => {
    // Paid and accepted, but still in the seller's hands. "Verified purchase"
    // has to mean the thing arrived, or the badge means "paid for" and every
    // pre-order carries it.
    const purchase = await paidButNotDelivered('undelivered', alpha);

    const res = await asUser(purchase.token, 'POST', '/me/reviews', {
      orderItemId: purchase.orderItemId,
      rating: 5,
    });
    expect(res.statusCode).toBe(404);
  });

  it("REFUSES somebody else's delivered line", async () => {
    const mine = await delivered('theirs', alpha);
    const stranger = await register(`${NS}-stranger@example.test`);

    const res = await asUser(stranger.token, 'POST', '/me/reviews', {
      orderItemId: mine.orderItemId,
      rating: 1,
    });

    /**
     * A 404, never a 403. Three situations answer identically here - no such
     * line, somebody else's line, and a line that has not arrived - because
     * telling them apart tells a stranger which order lines exist and which
     * have been delivered, and the caller can do nothing differently with any
     * of the three.
     */
    expect(res.statusCode).toBe(404);
  });

  it('refuses a SECOND review of the same purchase', async () => {
    const purchase = await delivered('once', alpha);

    const first = await asUser(purchase.token, 'POST', '/me/reviews', {
      orderItemId: purchase.orderItemId,
      rating: 4,
    });
    expect(first.statusCode).toBe(201);

    const second = await asUser(purchase.token, 'POST', '/me/reviews', {
      orderItemId: purchase.orderItemId,
      rating: 1,
    });

    // A UNIQUE CONSTRAINT, not a prior SELECT - two concurrent submissions
    // would both pass a lookup, which is the rule every other idempotent write
    // in this codebase follows.
    expect(second.statusCode).toBe(409);
  });

  it('offers the buyer exactly the lines they may still review', async () => {
    const purchase = await delivered('pending', alpha);

    const before = await asUser(purchase.token, 'GET', '/me/reviews/pending');
    expect(
      json<{ items: { orderItemId: string }[] }>(before).items.map((i) => i.orderItemId),
    ).toContain(purchase.orderItemId);

    await asUser(purchase.token, 'POST', '/me/reviews', {
      orderItemId: purchase.orderItemId,
      rating: 3,
    });

    // Gone once used. A "write a review" prompt that offers a line the server
    // will then refuse is worse than no prompt at all.
    const after = await asUser(purchase.token, 'GET', '/me/reviews/pending');
    expect(
      json<{ items: { orderItemId: string }[] }>(after).items.map((i) => i.orderItemId),
    ).not.toContain(purchase.orderItemId);
  });

  it('does not need a token to READ what was written', async () => {
    // The whole reason these tables are platform-owned: the rating is on the
    // product page, which an anonymous shopper opens with no session and no
    // tenant. A review behind a login is a review nobody reads before buying.
    const res = await app.inject({ method: 'GET', url: `/products/${productId}/reviews` });
    expect(res.statusCode).toBe(200);
    expect(json<{ items: unknown[] }>(res).items.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ criterion 2

describe('aggregates recompute on edit and delete', () => {
  it('counts a new review into the histogram and the average', async () => {
    const fresh = await freshProduct('agg-create');
    const purchase = await delivered('agg-create', alpha, fresh.listingId);

    const empty = await summary(fresh.productId);
    expect(empty).toMatchObject({ average: null, total: 0 });

    await asUser(purchase.token, 'POST', '/me/reviews', {
      orderItemId: purchase.orderItemId,
      rating: 4,
    });

    expect(await summary(fresh.productId)).toMatchObject({ average: 4, total: 1 });
  });

  it('MOVES the average when the stars are edited', async () => {
    const fresh = await freshProduct('agg-edit');
    const purchase = await delivered('agg-edit', alpha, fresh.listingId);

    const created = await asUser(purchase.token, 'POST', '/me/reviews', {
      orderItemId: purchase.orderItemId,
      rating: 5,
    });
    const reviewId = json<{ id: string }>(created).id;
    expect(await summary(fresh.productId)).toMatchObject({ average: 5, total: 1 });

    const edited = await asUser(purchase.token, 'PATCH', `/me/reviews/${reviewId}`, {
      rating: 2,
    });
    expect(edited.statusCode).toBe(200);

    // Not 5, and not (5+2)/2 either. A full recompute from source rather than a
    // +1/-1, which is how an aggregate usually drifts: an edit is a decrement
    // and an increment that must BOTH land.
    expect(await summary(fresh.productId)).toMatchObject({ average: 2, total: 1 });
  });

  it('EMPTIES the histogram when the author deletes their review', async () => {
    const fresh = await freshProduct('agg-delete');
    const purchase = await delivered('agg-delete', alpha, fresh.listingId);

    const created = await asUser(purchase.token, 'POST', '/me/reviews', {
      orderItemId: purchase.orderItemId,
      rating: 1,
    });
    const reviewId = json<{ id: string }>(created).id;
    expect(await summary(fresh.productId)).toMatchObject({ total: 1 });

    const removed = await asUser(purchase.token, 'DELETE', `/me/reviews/${reviewId}`);
    expect(removed.statusCode).toBe(200);

    // Back to null, not to zero. Nobody has reviewed this product, which is a
    // different fact from everybody having given it nothing.
    expect(await summary(fresh.productId)).toMatchObject({ average: null, total: 0 });
  });

  it('renders five empty bars rather than nothing for an unreviewed product', async () => {
    const fresh = await freshProduct('agg-empty');
    const view = await summary(fresh.productId);
    expect(view.distribution).toHaveLength(5);
    expect(view.distribution.every((bar) => bar.count === 0)).toBe(true);
  });

  it('NEVER DRIFTS from the reviews it summarises', async () => {
    /**
     * The `listings.available_stock` pattern, on a second denormalisation.
     *
     * The comparison lives in `review-aggregates.ts` beside the statements it
     * checks, not in this test: a comparison written here would be a second
     * definition of what a rating is, and it would agree with the bug. After
     * everything above - creates, an edit, a delete - nothing may disagree.
     */
    const drift = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute<{ kind: string; id: string }>(ratingDrift),
    );
    expect(drift.rows).toEqual([]);
  });
});

// ------------------------------------------------------------------ criterion 3

describe('moderation removes content from all surfaces', () => {
  it('takes a removed review off the product page AND out of the histogram', async () => {
    const fresh = await freshProduct('mod-remove');
    const purchase = await delivered('mod-remove', alpha, fresh.listingId);

    const created = await asUser(purchase.token, 'POST', '/me/reviews', {
      orderItemId: purchase.orderItemId,
      rating: 5,
      body: 'Take this down',
    });
    const reviewId = json<{ id: string }>(created).id;
    expect(await summary(fresh.productId)).toMatchObject({ average: 5, total: 1 });

    const moderated = await asAdmin('POST', `/admin/reviews/${reviewId}/moderate`, {
      action: 'REMOVE',
      reason: 'Off-topic',
    });
    expect(moderated.statusCode).toBe(201);

    // SURFACE ONE: the list under the product.
    const listed = await app.inject({
      method: 'GET',
      url: `/products/${fresh.productId}/reviews`,
    });
    expect(json<{ items: { id: string }[] }>(listed).items.map((r) => r.id)).not.toContain(
      reviewId,
    );

    /**
     * SURFACE TWO: the rating above the list.
     *
     * The one that would be missed. A page that stops showing a review while
     * the average above it still counts the stars is visibly inconsistent, and
     * it is the shape this breaks in if the aggregate refresh is ever dropped
     * from the moderation path - the list filters REMOVED on its own, so the
     * first surface would keep working and hide the second.
     */
    expect(await summary(fresh.productId)).toMatchObject({ average: null, total: 0 });
  });

  it('puts it back, histogram and all, on RESTORE', async () => {
    const fresh = await freshProduct('mod-restore');
    const purchase = await delivered('mod-restore', alpha, fresh.listingId);
    const created = await asUser(purchase.token, 'POST', '/me/reviews', {
      orderItemId: purchase.orderItemId,
      rating: 4,
    });
    const reviewId = json<{ id: string }>(created).id;

    await asAdmin('POST', `/admin/reviews/${reviewId}/moderate`, {
      action: 'REMOVE',
      reason: 'Mistake',
    });
    expect(await summary(fresh.productId)).toMatchObject({ total: 0 });

    // A STATUS, not a DELETE, which is exactly what makes this reversible -
    // and what will let Phase 11's audit log show who did what.
    await asAdmin('POST', `/admin/reviews/${reviewId}/moderate`, {
      action: 'RESTORE',
      reason: 'Appeal upheld',
    });
    expect(await summary(fresh.productId)).toMatchObject({ average: 4, total: 1 });
  });

  it('a REPORT flags without hiding, and a flagged review still counts', async () => {
    const fresh = await freshProduct('mod-report');
    const purchase = await delivered('mod-report', alpha, fresh.listingId);
    const created = await asUser(purchase.token, 'POST', '/me/reviews', {
      orderItemId: purchase.orderItemId,
      rating: 1,
      body: 'Seller disputes this',
    });
    const reviewId = json<{ id: string }>(created).id;

    // No token. Requiring an account to report abuse means the abuse stays up
    // while the person who noticed it registers.
    const reported = await app.inject({
      method: 'POST',
      url: `/reviews/${reviewId}/report`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(reported.statusCode).toBe(201);
    expect(json<{ flagged: boolean }>(reported).flagged).toBe(true);

    /**
     * STILL VISIBLE, AND STILL COUNTED. A report is an accusation, not a
     * verdict - hiding content the moment somebody objects hands a heckler's
     * veto to whoever complains first, and on a marketplace the first
     * complainer is usually the seller the review is about.
     */
    const listed = await app.inject({
      method: 'GET',
      url: `/products/${fresh.productId}/reviews`,
    });
    expect(json<{ items: { id: string }[] }>(listed).items.map((r) => r.id)).toContain(reviewId);
    expect(await summary(fresh.productId)).toMatchObject({ average: 1, total: 1 });

    // And it is in front of a human.
    const queue = await asAdmin('GET', '/admin/reviews');
    expect(json<{ items: { id: string }[] }>(queue).items.map((r) => r.id)).toContain(reviewId);
  });

  it('cannot be undone by more reports once a moderator has removed it', async () => {
    const fresh = await freshProduct('mod-brigade');
    const purchase = await delivered('mod-brigade', alpha, fresh.listingId);
    const created = await asUser(purchase.token, 'POST', '/me/reviews', {
      orderItemId: purchase.orderItemId,
      rating: 5,
    });
    const reviewId = json<{ id: string }>(created).id;

    await asAdmin('POST', `/admin/reviews/${reviewId}/moderate`, {
      action: 'REMOVE',
      reason: 'Abuse',
    });

    const reported = await app.inject({
      method: 'POST',
      url: `/reviews/${reviewId}/report`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    // 200 and `flagged: false`: the flag moves only a PUBLISHED review, so no
    // volume of reports can drag a removed one back into the queue.
    expect(reported.statusCode).toBe(201);
    expect(json<{ flagged: boolean }>(reported).flagged).toBe(false);
    expect(await summary(fresh.productId)).toMatchObject({ total: 0 });
  });

  it('refuses moderation to anyone who is not a platform admin', async () => {
    const fresh = await freshProduct('mod-authz');
    const purchase = await delivered('mod-authz', alpha, fresh.listingId);
    const created = await asUser(purchase.token, 'POST', '/me/reviews', {
      orderItemId: purchase.orderItemId,
      rating: 1,
    });
    const reviewId = json<{ id: string }>(created).id;

    /**
     * THE WORST FAILURE MODE THIS FEATURE HAS: a seller removing a review of
     * their own product. Moderation lives on a @PlatformAdmin() controller and
     * is not organisation-scoped, which makes that structurally impossible
     * rather than a rule somebody follows.
     */
    const bySeller = await asUser(alpha.token, 'POST', `/admin/reviews/${reviewId}/moderate`, {
      action: 'REMOVE',
      reason: 'I did not like it',
    });
    expect(bySeller.statusCode).toBe(403);

    const byAuthor = await asUser(
      purchase.token,
      'POST',
      `/admin/reviews/${reviewId}/moderate`,
      { action: 'REMOVE', reason: 'Changed my mind' },
    );
    expect(byAuthor.statusCode).toBe(403);
  });
});

// ------------------------------------------ the socket Phase 2 left empty

describe('the buy box finally has a seller rating to rank on', () => {
  it('breaks a landed-price TIE on the better-reviewed seller', async () => {
    /**
     * PRD 8.3: "rank eligible listings by landed price, THEN SELLER RATING,
     * then dispatch speed, then stock depth."
     *
     * That key has been in `rankOffers` since Phase 2 and
     * `catalogue.service.ts` has passed it null for every seller ever since,
     * with a comment saying so. Both sellers here list the same variant at the
     * same landed price and the same dispatch time, so the rating is the ONLY
     * thing that can decide it - which is the only way to prove the value
     * actually arrives rather than being computed and dropped.
     */
    await rate(alpha, 5, 'tie-alpha');
    await rate(beta, 2, 'tie-beta');

    const page = await app.inject({ method: 'GET', url: `/products/${productSlug}` });
    expect(page.statusCode).toBe(200);

    const buyBox = json<{
      variants: { buyBox: { winner: { seller: { id: string } } | null } }[];
    }>(page).variants[0]?.buyBox;

    expect(buyBox?.winner?.seller.id).toBe(alpha.orgId);
  });

  it('hands the win back when moderation takes the good reviews away', async () => {
    // The tiebreak reading a LIVE aggregate rather than a cached number, seen
    // from the surface where a wrong rating changes who gets the sale.
    const reviews = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx
        .select({ id: schema.reviews.id })
        .from(schema.reviews)
        .where(eq(schema.reviews.sellerOrgId, alpha.orgId)),
    );

    for (const review of reviews) {
      await asAdmin('POST', `/admin/reviews/${review.id}/moderate`, {
        action: 'REMOVE',
        reason: 'Review ring',
      });
    }

    const page = await app.inject({ method: 'GET', url: `/products/${productSlug}` });
    const buyBox = json<{
      variants: { buyBox: { winner: { seller: { id: string } } | null } }[];
    }>(page).variants[0]?.buyBox;

    // Alpha is now UNRATED, which sorts behind a rated seller rather than below
    // a one-star - `averageRating` returns null for an empty histogram and the
    // ranking treats null as "no information", not as "bad".
    expect(buyBox?.winner?.seller.id).toBe(beta.orgId);
  });
});

// ---- fixture ---------------------------------------------------------------

/**
 * Two sellers on one shared product, each with stock, plus a platform admin.
 *
 * The shared catalogue entry is PRD 8.3's whole premise and it is what makes
 * the tiebreak testable: two offers that differ in nothing but their sellers'
 * reputations.
 */
async function buildFixture(): Promise<void> {
  await withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
    const [category] = await tx
      .insert(schema.categories)
      .values({ slug: `${NS}-goods`, name: 'Goods', path: `${NS.replace(/-/g, '_')}_goods` })
      .returning({ id: schema.categories.id });
    if (!category) throw new Error('fixture: category');

    productSlug = `${NS}-widget`;
    const [product] = await tx
      .insert(schema.products)
      .values({
        slug: productSlug,
        name: 'Reviewed Widget',
        categoryId: category.id,
        status: 'ACTIVE',
      })
      .returning({ id: schema.products.id });
    if (!product) throw new Error('fixture: product');
    productId = product.id;

    const [variant] = await tx
      .insert(schema.productVariants)
      .values({ productId: product.id, sku: `${NS}-SKU`, name: 'Standard', position: 0 })
      .returning({ id: schema.productVariants.id });
    if (!variant) throw new Error('fixture: variant');

    alpha = await makeSeller(tx, 'alpha', variant.id);
    beta = await makeSeller(tx, 'beta', variant.id);

    await tx.execute(upsertSearchDocument(product.id));
  });

  alpha.token = (await register(`${NS}-alpha-owner@example.test`)).token;
  beta.token = (await register(`${NS}-beta-owner@example.test`)).token;
  await grantOwner(alpha.orgId, `${NS}-alpha-owner@example.test`);
  await grantOwner(beta.orgId, `${NS}-beta-owner@example.test`);

  adminToken = await makeAdmin();
}

/** Identical offers: same price, same shipping, same dispatch. Only the
 *  reputation can separate them, which is the point. */
async function makeSeller(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  label: string,
  variantId: string,
): Promise<Seller> {
  const [org] = await tx
    .insert(schema.organisations)
    .values({
      slug: `${NS}-${label}`,
      legalName: `${label} Ltd`,
      displayName: `${label} Ltd`,
      status: 'ACTIVE',
      countryCode: 'BD',
      defaultCurrency: 'BDT',
    })
    .returning({ id: schema.organisations.id });
  if (!org) throw new Error('fixture: org');

  const [warehouse] = await tx
    .insert(schema.warehouses)
    .values({ tenantId: org.id, name: `${NS}-${label}-wh`, pincode: '1205', isDefault: true })
    .returning({ id: schema.warehouses.id });
  if (!warehouse) throw new Error('fixture: warehouse');

  const [listing] = await tx
    .insert(schema.listings)
    .values({
      tenantId: org.id,
      variantId,
      status: 'ACTIVE',
      priceAmount: 20_000,
      priceCurrency: 'BDT',
      shippingAmount: 0,
      dispatchDays: 1,
      availableStock: 500,
    })
    .returning({ id: schema.listings.id });
  if (!listing) throw new Error('fixture: listing');

  await tx
    .insert(schema.inventoryItems)
    .values({ tenantId: org.id, listingId: listing.id, warehouseId: warehouse.id, onHand: 500 });

  return { orgId: org.id, listingId: listing.id, token: '' };
}

/** A second product nobody else touches, for the aggregate tests - so an
 *  assertion about an average is about this test's reviews and no others. */
async function freshProduct(label: string): Promise<{ productId: string; listingId: string }> {
  let ids = { productId: '', listingId: '' };

  await withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
    const [category] = await tx
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.slug, `${NS}-goods`))
      .limit(1);
    if (!category) throw new Error('fixture: category missing');

    const [product] = await tx
      .insert(schema.products)
      .values({
        slug: `${NS}-${label}`,
        name: `Widget ${label}`,
        categoryId: category.id,
        status: 'ACTIVE',
      })
      .returning({ id: schema.products.id });
    if (!product) throw new Error('fixture: product');

    const [variant] = await tx
      .insert(schema.productVariants)
      .values({ productId: product.id, sku: `${NS}-${label}-SKU`, name: 'Standard', position: 0 })
      .returning({ id: schema.productVariants.id });
    if (!variant) throw new Error('fixture: variant');

    const [warehouse] = await tx
      .select({ id: schema.warehouses.id })
      .from(schema.warehouses)
      .where(eq(schema.warehouses.tenantId, alpha.orgId))
      .limit(1);
    if (!warehouse) throw new Error('fixture: warehouse missing');

    const [listing] = await tx
      .insert(schema.listings)
      .values({
        tenantId: alpha.orgId,
        variantId: variant.id,
        status: 'ACTIVE',
        priceAmount: 20_000,
        priceCurrency: 'BDT',
        shippingAmount: 0,
        dispatchDays: 1,
        availableStock: 100,
      })
      .returning({ id: schema.listings.id });
    if (!listing) throw new Error('fixture: listing');

    await tx.insert(schema.inventoryItems).values({
      tenantId: alpha.orgId,
      listingId: listing.id,
      warehouseId: warehouse.id,
      onHand: 100,
    });

    ids = { productId: product.id, listingId: listing.id };
  });

  return ids;
}

// ---- journeys --------------------------------------------------------------

type Purchase = { token: string; orderId: string; orderItemId: string };

/** A buyer who paid, whose seller accepted, and whose parcel arrived. */
async function delivered(label: string, seller: Seller, listingId?: string): Promise<Purchase> {
  const purchase = await paidButNotDelivered(label, seller, listingId);

  const dispatched = await asSeller(seller, 'POST', `/seller/orders/${purchase.orderId}/dispatch`, {
    idempotencyKey: `${NS}-${label}-dispatch`,
  });
  expect(dispatched.statusCode).toBe(200);

  for (const shipment of json<{ shipments: { id: string }[] }>(dispatched).shipments) {
    const res = await asSeller(
      seller,
      'POST',
      `/seller/orders/${purchase.orderId}/shipments/${shipment.id}/delivered`,
    );
    expect(res.statusCode).toBe(200);
  }

  return purchase;
}

async function paidButNotDelivered(
  label: string,
  seller: Seller,
  listingId?: string,
): Promise<Purchase> {
  const buyer = await register(`${NS}-${label}@example.test`);
  const addressId = await createAddress(buyer.token);

  const added = await asUser(buyer.token, 'POST', '/cart/items', {
    listingId: listingId ?? seller.listingId,
    quantity: 1,
  });
  expect(added.statusCode).toBe(201);

  const quoteRes = await asUser(buyer.token, 'GET', `/checkout/quote?addressId=${addressId}`);
  const quote = json<{ total: { amount: number; currency: string } }>(quoteRes);

  const confirmed = await asUser(buyer.token, 'POST', '/checkout/confirm', {
    addressId,
    paymentMethod: 'mock',
    idempotencyKey: `${NS}-${label}`,
    expectedTotal: quote.total,
  });
  expect(confirmed.statusCode).toBe(201);
  const body = json<{ orders: { id: string }[]; paymentIntentId: string }>(confirmed);
  const orderId = body.orders[0]?.id;
  if (orderId === undefined) throw new Error('no order placed');

  // The gateway calls back; checkout never advances payment status itself.
  const mock = app.get(
    (await import('../src/modules/payments/mock.adapter.js')).MockPaymentAdapter,
  );
  const raw = JSON.stringify({
    id: `${NS}-evt-${label}`,
    type: 'payment_succeeded',
    providerRef: `mock_${body.paymentIntentId}`,
  });
  const settled = await app.inject({
    method: 'POST',
    url: '/webhooks/payment/mock',
    headers: { 'content-type': 'application/json', 'x-mock-signature': mock.sign(raw) },
    payload: raw,
  });
  expect(settled.statusCode).toBe(200);

  const accepted = await asSeller(seller, 'POST', `/seller/orders/${orderId}/accept`);
  expect(accepted.statusCode).toBe(200);

  const detail = await asSeller(seller, 'GET', `/seller/orders/${orderId}`);
  const orderItemId = json<{ items: { id: string }[] }>(detail).items[0]?.id;
  if (orderItemId === undefined) throw new Error('no order item');

  return { token: buyer.token, orderId, orderItemId };
}

/** Buys, receives and reviews, in one line, for the ranking tests. */
async function rate(seller: Seller, stars: number, label: string): Promise<void> {
  const purchase = await delivered(label, seller);
  const res = await asUser(purchase.token, 'POST', '/me/reviews', {
    orderItemId: purchase.orderItemId,
    rating: stars,
  });
  expect(res.statusCode).toBe(201);
}

// ---- helpers ---------------------------------------------------------------

type Summary = {
  average: number | null;
  total: number;
  distribution: { stars: number; count: number; share: number }[];
};

async function summary(product: string): Promise<Summary> {
  const res = await app.inject({ method: 'GET', url: `/products/${product}/reviews/summary` });
  expect(res.statusCode).toBe(200);
  return json<Summary>(res);
}

async function register(email: string): Promise<{ token: string; id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: PASSWORD, displayName: 'Reviewer' },
  });
  expect(res.statusCode).toBe(201);
  const body = json<{ accessToken: string; user: { id: string } }>(res);
  return { token: body.accessToken, id: body.user.id };
}

async function createAddress(token: string): Promise<string> {
  const res = await asUser(token, 'POST', '/me/addresses', {
    recipientName: 'Reviews Buyer',
    phone: '+8801700000000',
    line1: '1 Test Road',
    city: 'Dhaka',
    district: 'Dhaka',
    postcode: '1205',
    countryCode: 'BD',
  });
  expect(res.statusCode).toBe(201);
  return json<{ id: string }>(res).id;
}

async function grantOwner(orgId: string, email: string): Promise<void> {
  await withTenant({ tenantId: orgId, userId: null, isAdmin: true }, async (tx) => {
    const [user] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (!user) throw new Error('fixture: user missing');
    await tx.insert(schema.orgMembers).values({ tenantId: orgId, userId: user.id, role: 'OWNER' });
  });
}

/** A platform admin of this file's own, never a seeded one - granting a role to
 *  a shared user changes what it can do in another test file. */
async function makeAdmin(): Promise<string> {
  const email = `${NS}-admin@example.test`;
  const created = await register(email);

  await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
    tx
      .update(schema.users)
      .set({ platformRole: 'ADMIN' })
      .where(eq(schema.users.id, created.id)),
  );

  // Re-login, because `platform_role` is a TOKEN CLAIM that AuthGuard reads -
  // the token minted a moment ago still says BUYER.
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: PASSWORD },
  });
  // 200, not 201: login RETURNS a token rather than creating a resource, and
  // the controller says so. Register is the 201.
  expect(res.statusCode).toBe(200);
  return json<{ accessToken: string }>(res).accessToken;
}

function asUser(
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (payload === undefined) return app.inject({ method, url, headers });
  headers['content-type'] = 'application/json';
  return app.inject({ method, url, headers, payload });
}

function asSeller(
  seller: Seller,
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${seller.token}`,
    'x-tenant-id': seller.orgId,
  };
  if (payload === undefined) return app.inject({ method, url, headers });
  headers['content-type'] = 'application/json';
  return app.inject({ method, url, headers, payload });
}

function asAdmin(
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return asUser(adminToken, method, url, payload);
}

function json<T>(res: LightMyRequestResponse): T {
  return JSON.parse(res.body) as T;
}
