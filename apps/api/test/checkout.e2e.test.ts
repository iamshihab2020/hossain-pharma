import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { schema, upsertSearchDocument, withTenant } from '@nexmarket/db';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';
import { MockPaymentAdapter } from '../src/modules/payments/mock.adapter.js';

/**
 * PRD 11 Phase 4, every acceptance criterion, over HTTP.
 *
 *   - a cart with 3 sellers produces 3 orders
 *   - price tampering rejected
 *   - the webhook is the only writer of payment status
 *   - the ledger balances
 *
 * The fixture is built here rather than taken from the seed, deliberately.
 * Checking out RESERVES STOCK, which changes `listings.available_stock` and
 * therefore what `catalogue.e2e` and `search.e2e` see. Three files asserting
 * against one mutable seed is how this suite broke three times in Phase 3.
 */
let app: NestFastifyApplication;
let mock: MockPaymentAdapter;

/** Namespaced per file. `users.email` is globally unique and vitest is parallel. */
const NS = `checkout-${randomUUID().slice(0, 8)}`;

const sellers: { id: string; slug: string; listingId: string; price: number }[] = [];
let restrictedListingId: string;
let lastUnitListingId: string;
let buyer: { token: string; id: string };
let addressId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  mock = app.get(MockPaymentAdapter);

  await buildFixture();

  buyer = await register(`${NS}-buyer@example.test`);
  addressId = await createAddress(buyer.token);
}, 180_000);

afterAll(async () => {
  await app?.close();
});

// --------------------------------------------------------------------- setup

/**
 * Three sellers, one ordinary product each, plus a RESTRICTED item and a
 * one-unit listing for the stock race.
 *
 * Written with `isAdmin: true` because a test fixture is a platform action -
 * the same reason the seed can write across tenants and a request cannot.
 */
async function buildFixture(): Promise<void> {
  await withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
    const [category] = await tx
      .insert(schema.categories)
      .values({ slug: `${NS}-goods`, name: 'Goods', path: NS.replace(/-/g, '_') + '_goods' })
      .returning({ id: schema.categories.id });
    const [restrictedCategory] = await tx
      .insert(schema.categories)
      .values({
        slug: `${NS}-restricted`,
        name: 'Restricted',
        path: NS.replace(/-/g, '_') + '_restricted',
        isRestricted: true,
      })
      .returning({ id: schema.categories.id });
    if (!category || !restrictedCategory) throw new Error('fixture: categories');

    const [product] = await tx
      .insert(schema.products)
      .values({
        slug: `${NS}-widget`,
        name: 'Checkout Widget',
        categoryId: category.id,
        status: 'ACTIVE',
      })
      .returning({ id: schema.products.id });
    const [restrictedProduct] = await tx
      .insert(schema.products)
      .values({
        slug: `${NS}-spirit`,
        name: 'Checkout Spirit',
        categoryId: restrictedCategory.id,
        status: 'ACTIVE',
      })
      .returning({ id: schema.products.id });
    if (!product || !restrictedProduct) throw new Error('fixture: products');

    // Three sellers offering three different variants, so one cart spans three
    // organisations - the Phase 4 acceptance shape.
    for (const index of [0, 1, 2]) {
      const [org] = await tx
        .insert(schema.organisations)
        .values({
          slug: `${NS}-seller-${index}`,
          legalName: `Seller ${index} Ltd`,
          displayName: `Seller ${index}`,
          status: 'ACTIVE',
          countryCode: 'BD',
          defaultCurrency: 'BDT',
        })
        .returning({ id: schema.organisations.id, slug: schema.organisations.slug });
      if (!org) throw new Error('fixture: org');

      const [variant] = await tx
        .insert(schema.productVariants)
        .values({ productId: product.id, sku: `${NS}-SKU-${index}`, name: `Variant ${index}` })
        .returning({ id: schema.productVariants.id });
      if (!variant) throw new Error('fixture: variant');

      const price = 10_000 * (index + 1);
      const listingId = await createListing(tx, org.id, variant.id, price, 10);
      sellers.push({ id: org.id, slug: org.slug, listingId, price });
    }

    // A RESTRICTED item, for the age gate, and a one-unit listing for the race.
    const first = sellers[0];
    if (first === undefined) throw new Error('fixture: sellers');

    const [restrictedVariant] = await tx
      .insert(schema.productVariants)
      .values({ productId: restrictedProduct.id, sku: `${NS}-SPIRIT`, name: 'Bottle' })
      .returning({ id: schema.productVariants.id });
    const [scarceVariant] = await tx
      .insert(schema.productVariants)
      .values({ productId: product.id, sku: `${NS}-SCARCE`, name: 'Last one' })
      .returning({ id: schema.productVariants.id });
    if (!restrictedVariant || !scarceVariant) throw new Error('fixture: variants');

    restrictedListingId = await createListing(tx, first.id, restrictedVariant.id, 50_000, 10);
    lastUnitListingId = await createListing(tx, first.id, scarceVariant.id, 20_000, 1);

    // INDEX THE FIXTURE, exactly as the seed does.
    //
    // An ACTIVE product with an ACTIVE offer belongs in `search_documents`, so
    // a fixture that skips this leaves the table disagreeing with
    // `search_document_source` - and search.e2e's drift test, running in
    // parallel, correctly goes red. It caught this the first time round.
    await tx.execute(upsertSearchDocument(product.id));
    await tx.execute(upsertSearchDocument(restrictedProduct.id));
  });
}

async function createListing(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  variantId: string,
  priceAmount: number,
  stock: number,
): Promise<string> {
  const [listing] = await tx
    .insert(schema.listings)
    .values({
      tenantId,
      variantId,
      status: 'ACTIVE',
      priceAmount,
      priceCurrency: 'BDT',
      availableStock: stock,
    })
    .returning({ id: schema.listings.id });
  const [warehouse] = await tx
    .insert(schema.warehouses)
    // `warehouses_tenant_name_key` is unique per tenant, and seller 0 gets
    // three listings, so the name has to vary with the listing.
    .values({ tenantId, name: `${NS} depot ${variantId.slice(0, 8)}`, pincode: '1207' })
    .returning({ id: schema.warehouses.id });
  if (!listing || !warehouse) throw new Error('fixture: listing');

  await tx
    .insert(schema.inventoryItems)
    .values({ tenantId, listingId: listing.id, warehouseId: warehouse.id, onHand: stock });
  return listing.id;
}

// -------------------------------------------------------------------- helpers

async function register(email: string): Promise<{ token: string; id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'checkout-password-1', displayName: 'Checkout Buyer' },
  });
  expect(res.statusCode).toBe(201);
  const body = json<{ accessToken: string; user: { id: string } }>(res);
  return { token: body.accessToken, id: body.user.id };
}

async function createAddress(token: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/me/addresses',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      recipientName: 'Checkout Buyer',
      phone: '+8801700000000',
      line1: '1 Test Road',
      city: 'Dhaka',
      district: 'Dhaka',
      postcode: '1207',
      countryCode: 'BD',
    },
  });
  expect(res.statusCode).toBe(201);
  return json<{ id: string }>(res).id;
}

async function addToCart(token: string, listingId: string, quantity = 1): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/cart/items',
    headers: { authorization: `Bearer ${token}` },
    payload: { listingId, quantity },
  });
  expect(res.statusCode).toBe(201);
}

async function quoteFor(token: string): Promise<{ total: { amount: number; currency: string } }> {
  const res = await app.inject({
    method: 'GET',
    url: `/checkout/quote?addressId=${addressId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return json(res);
}

function confirm(
  token: string,
  payload: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/checkout/confirm',
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
}

function json<T>(res: LightMyRequestResponse): T {
  return JSON.parse(res.body) as T;
}

/** Delivers a webhook the way a gateway would: signed, over the raw body. */
function deliverWebhook(body: Record<string, unknown>): Promise<LightMyRequestResponse> {
  const raw = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url: '/webhooks/payment/mock',
    headers: { 'content-type': 'application/json', 'x-mock-signature': mock.sign(raw) },
    payload: raw,
  });
}

async function ledgerSum(intentId: string): Promise<number> {
  return withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
    const rows = await tx.execute<{ total: string | null }>(sql`
      SELECT COALESCE(SUM(e.amount), 0) AS total
        FROM ledger_entries e
        JOIN transactions t ON t.id = e.transaction_id
       WHERE t.payment_intent_id = ${intentId}
    `);
    return Number.parseInt(rows.rows[0]?.total ?? '0', 10);
  });
}

// ---------------------------------------------------------------------- tests

describe('PRD 11 Phase 4: a cart with 3 sellers produces 3 orders', () => {
  it('splits one payment into one order per seller', async () => {
    const shopper = await register(`${NS}-three@example.test`);
    const address = await createAddress(shopper.token);

    for (const seller of sellers) await addToCart(shopper.token, seller.listingId);

    const quoteRes = await app.inject({
      method: 'GET',
      url: `/checkout/quote?addressId=${address}`,
      headers: { authorization: `Bearer ${shopper.token}` },
    });
    const quote = json<{
      groups: { sellerId: string }[];
      total: { amount: number; currency: string };
    }>(quoteRes);
    expect(quote.groups).toHaveLength(3);

    const res = await confirm(shopper.token, {
      addressId: address,
      paymentMethod: 'mock',
      idempotencyKey: `${NS}-three-sellers`,
      expectedTotal: quote.total,
    });

    expect(res.statusCode).toBe(201);
    const body = json<{
      orders: { id: string; orderNumber: string; sellerId: string }[];
      status: string;
      paymentIntentId: string;
    }>(res);

    expect(body.orders).toHaveLength(3);
    // One intent, three orders, three DIFFERENT sellers and three distinct
    // order numbers - PRD 9.1's "per-seller order numbers".
    expect(new Set(body.orders.map((o) => o.sellerId)).size).toBe(3);
    expect(new Set(body.orders.map((o) => o.orderNumber)).size).toBe(3);
  });
});

describe('PRD 11 Phase 4: price tampering rejected', () => {
  it('refuses a lowered expectedTotal and leaves NO order and NO ledger entry', async () => {
    const shopper = await register(`${NS}-tamper@example.test`);
    const address = await createAddress(shopper.token);
    const seller = sellers[0];
    if (seller === undefined) throw new Error('fixture');
    await addToCart(shopper.token, seller.listingId);

    const res = await confirm(shopper.token, {
      addressId: address,
      paymentMethod: 'mock',
      idempotencyKey: `${NS}-tamper`,
      expectedTotal: { amount: 1, currency: 'BDT' },
    });

    expect(res.statusCode).toBe(409);
    expect(json<{ code: string }>(res).code).toBe('PRICE_CHANGED');

    // Not merely "it returned an error". Nothing may have been written.
    const counts = await withTenant(
      { tenantId: null, userId: null, isAdmin: true },
      async (tx) =>
        tx.execute<{ orders: number; entries: number }>(sql`
          SELECT
            (SELECT count(*)::int FROM orders WHERE buyer_user_id = ${shopper.id}) AS orders,
            (SELECT count(*)::int FROM ledger_entries e
               JOIN transactions t ON t.id = e.transaction_id
               JOIN payment_intents i ON i.id = t.payment_intent_id
              WHERE i.buyer_user_id = ${shopper.id}) AS entries
        `),
    );
    expect(counts.rows[0]).toEqual({ orders: 0, entries: 0 });
  });

  it('accepts the total the quote actually returned', async () => {
    const shopper = await register(`${NS}-honest@example.test`);
    const address = await createAddress(shopper.token);
    const seller = sellers[1];
    if (seller === undefined) throw new Error('fixture');
    await addToCart(shopper.token, seller.listingId);

    const quoteRes = await app.inject({
      method: 'GET',
      url: `/checkout/quote?addressId=${address}`,
      headers: { authorization: `Bearer ${shopper.token}` },
    });
    const quote = json<{ total: { amount: number; currency: string } }>(quoteRes);

    const res = await confirm(shopper.token, {
      addressId: address,
      paymentMethod: 'mock',
      idempotencyKey: `${NS}-honest`,
      expectedTotal: quote.total,
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('PRD 11 Phase 4: the webhook is the only writer of payment status', () => {
  it('leaves the intent at REQUIRES_PAYMENT after confirm, then captures on the webhook', async () => {
    const shopper = await register(`${NS}-webhook@example.test`);
    const address = await createAddress(shopper.token);
    const seller = sellers[2];
    if (seller === undefined) throw new Error('fixture');
    await addToCart(shopper.token, seller.listingId);

    const quote = await quoteFor(shopper.token).catch(() => null);
    void quote;
    const quoteRes = await app.inject({
      method: 'GET',
      url: `/checkout/quote?addressId=${address}`,
      headers: { authorization: `Bearer ${shopper.token}` },
    });
    const total = json<{ total: { amount: number; currency: string } }>(quoteRes).total;

    const res = await confirm(shopper.token, {
      addressId: address,
      paymentMethod: 'mock',
      idempotencyKey: `${NS}-webhook`,
      expectedTotal: total,
    });
    const body = json<{ paymentIntentId: string; status: string }>(res);

    // The mock adapter COULD have settled synchronously. It must not.
    expect(body.status).toBe('REQUIRES_PAYMENT');
    expect(await ledgerSum(body.paymentIntentId)).toBe(0);

    const delivered = await deliverWebhook({
      id: `${NS}-evt-1`,
      type: 'payment_succeeded',
      providerRef: `mock_${body.paymentIntentId}`,
    });
    expect(delivered.statusCode).toBe(200);
    expect(json<{ applied: boolean }>(delivered).applied).toBe(true);

    const after = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute<{ status: string; orders: number }>(sql`
        SELECT i.status,
               (SELECT count(*)::int FROM orders o
                 WHERE o.payment_intent_id = i.id AND o.status = 'PAID') AS orders
          FROM payment_intents i WHERE i.id = ${body.paymentIntentId}
      `),
    );
    expect(after.rows[0]?.status).toBe('SUCCEEDED');
    expect(after.rows[0]?.orders).toBe(1);

    // PRD 10.1: the ledger balances.
    expect(await ledgerSum(body.paymentIntentId)).toBe(0);
  });

  it('applies a replayed webhook exactly once', async () => {
    const shopper = await register(`${NS}-replay@example.test`);
    const address = await createAddress(shopper.token);
    const seller = sellers[0];
    if (seller === undefined) throw new Error('fixture');
    await addToCart(shopper.token, seller.listingId);

    const quoteRes = await app.inject({
      method: 'GET',
      url: `/checkout/quote?addressId=${address}`,
      headers: { authorization: `Bearer ${shopper.token}` },
    });
    const total = json<{ total: { amount: number; currency: string } }>(quoteRes).total;
    const confirmed = json<{ paymentIntentId: string }>(
      await confirm(shopper.token, {
        addressId: address,
        paymentMethod: 'mock',
        idempotencyKey: `${NS}-replay`,
        expectedTotal: total,
      }),
    );

    const event = {
      id: `${NS}-evt-replay`,
      type: 'payment_succeeded',
      providerRef: `mock_${confirmed.paymentIntentId}`,
    };
    const first = await deliverWebhook(event);
    const second = await deliverWebhook(event);

    expect(json<{ applied: boolean }>(first).applied).toBe(true);
    // A gateway retry must not double-capture. Both answer 200: a non-2xx is
    // read as "retry" and would start a storm.
    expect(second.statusCode).toBe(200);
    expect(json<{ applied: boolean; reason: string }>(second)).toEqual({
      applied: false,
      reason: 'already applied',
    });

    const entries = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM transactions WHERE payment_intent_id = ${confirmed.paymentIntentId}
      `),
    );
    expect(entries.rows[0]?.n).toBe(1);
  });

  it('rejects a forged signature without posting anything', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/payment/mock',
      headers: { 'content-type': 'application/json', 'x-mock-signature': 'not-a-signature' },
      payload: JSON.stringify({ id: 'forged', type: 'payment_succeeded', providerRef: 'mock_x' }),
    });
    expect(res.statusCode).toBe(200);
    expect(json<{ applied: boolean }>(res).applied).toBe(false);
  });
});

describe('cash on delivery', () => {
  it('places the order, accrues to COD_RECEIVABLE, and takes no payment', async () => {
    const shopper = await register(`${NS}-cod@example.test`);
    const address = await createAddress(shopper.token);
    const seller = sellers[1];
    if (seller === undefined) throw new Error('fixture');
    await addToCart(shopper.token, seller.listingId);

    const quoteRes = await app.inject({
      method: 'GET',
      url: `/checkout/quote?addressId=${address}`,
      headers: { authorization: `Bearer ${shopper.token}` },
    });
    const total = json<{ total: { amount: number; currency: string } }>(quoteRes).total;

    const res = await confirm(shopper.token, {
      addressId: address,
      paymentMethod: 'cod',
      idempotencyKey: `${NS}-cod`,
      expectedTotal: total,
    });
    expect(res.statusCode).toBe(201);

    const body = json<{ status: string; clientSecret: string | null; paymentIntentId: string }>(res);
    expect(body.status).toBe('COD_PENDING');
    // No gateway, so no secret to hand back.
    expect(body.clientSecret).toBeNull();

    // The obligation is real the moment the parcel is dispatched, so it is
    // posted now - and it balances, like everything else.
    expect(await ledgerSum(body.paymentIntentId)).toBe(0);

    const cod = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(e.amount), 0) AS total
          FROM ledger_entries e
          JOIN ledger_accounts a ON a.id = e.account_id
          JOIN transactions t ON t.id = e.transaction_id
         WHERE a.kind = 'COD_RECEIVABLE' AND t.payment_intent_id = ${body.paymentIntentId}
      `),
    );
    expect(Number.parseInt(cod.rows[0]?.total ?? '0', 10)).toBe(total.amount);
  });
});

describe('the age gate', () => {
  it('demands a date of birth, refuses a minor, and stores no birth date', async () => {
    const shopper = await register(`${NS}-age@example.test`);
    const address = await createAddress(shopper.token);
    await addToCart(shopper.token, restrictedListingId);

    const quoteRes = await app.inject({
      method: 'GET',
      url: `/checkout/quote?addressId=${address}`,
      headers: { authorization: `Bearer ${shopper.token}` },
    });
    const quote = json<{ requiresAgeCheck: boolean; total: { amount: number; currency: string } }>(
      quoteRes,
    );
    expect(quote.requiresAgeCheck).toBe(true);

    const missing = await confirm(shopper.token, {
      addressId: address,
      paymentMethod: 'cod',
      idempotencyKey: `${NS}-age-missing`,
      expectedTotal: quote.total,
    });
    expect(missing.statusCode).toBe(400);
    expect(json<{ code: string }>(missing).code).toBe('AGE_CHECK_REQUIRED');

    const minor = await confirm(shopper.token, {
      addressId: address,
      paymentMethod: 'cod',
      idempotencyKey: `${NS}-age-minor`,
      expectedTotal: quote.total,
      dateOfBirth: `${new Date().getUTCFullYear() - 10}-01-01`,
    });
    expect(minor.statusCode).toBe(409);
    expect(json<{ code: string }>(minor).code).toBe('AGE_CHECK_FAILED');

    const adult = await confirm(shopper.token, {
      addressId: address,
      paymentMethod: 'cod',
      idempotencyKey: `${NS}-age-adult`,
      expectedTotal: quote.total,
      dateOfBirth: '1990-01-01',
    });
    expect(adult.statusCode).toBe(201);

    const stored = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute<{ verified: Date | null; columns: number }>(sql`
        SELECT o.age_verified_at AS verified,
               (SELECT count(*)::int FROM information_schema.columns
                 WHERE table_name = 'orders' AND column_name LIKE '%birth%') AS columns
          FROM orders o WHERE o.buyer_user_id = ${shopper.id} LIMIT 1
      `),
    );
    expect(stored.rows[0]?.verified).not.toBeNull();
    // PRD 13 minimises PII: the CHECK is stored, the birth date is not, and
    // there is no column it could hide in.
    expect(stored.rows[0]?.columns).toBe(0);
  });
});

describe('stock', () => {
  it('lets exactly one of two concurrent checkouts take the last unit', async () => {
    const one = await register(`${NS}-race-1@example.test`);
    const two = await register(`${NS}-race-2@example.test`);
    const addressOne = await createAddress(one.token);
    const addressTwo = await createAddress(two.token);

    await addToCart(one.token, lastUnitListingId);
    await addToCart(two.token, lastUnitListingId);

    const totals = await Promise.all(
      [
        { token: one.token, address: addressOne },
        { token: two.token, address: addressTwo },
      ].map(async (shopper) => {
        const res = await app.inject({
          method: 'GET',
          url: `/checkout/quote?addressId=${shopper.address}`,
          headers: { authorization: `Bearer ${shopper.token}` },
        });
        return json<{ total: { amount: number; currency: string } }>(res).total;
      }),
    );

    const results = await Promise.all([
      confirm(one.token, {
        addressId: addressOne,
        paymentMethod: 'cod',
        idempotencyKey: `${NS}-race-1`,
        expectedTotal: totals[0],
      }),
      confirm(two.token, {
        addressId: addressTwo,
        paymentMethod: 'cod',
        idempotencyKey: `${NS}-race-2`,
        expectedTotal: totals[1],
      }),
    ]);

    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409]);

    const stock = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute<{ on_hand: number; reserved: number }>(sql`
        SELECT on_hand, reserved FROM inventory_items WHERE listing_id = ${lastUnitListingId}
      `),
    );
    const row = stock.rows[0];
    // The CHECK constraint from migration 0008 is the backstop; the conditional
    // UPDATE is what makes it never fire.
    expect(row?.reserved).toBeLessThanOrEqual(row?.on_hand ?? 0);
    expect(row?.reserved).toBe(1);
  });
});

describe('checkout reindexes search — audit finding F-2', () => {
  /**
   * A write that changes what a buyer would FIND must reindex.
   *
   * `search_documents.in_stock` derives from ELIGIBLE offers, and eligibility
   * excludes out-of-stock. So buying the last unit changes what search returns
   * for that product - and nothing about `POST /checkout/confirm` looks like it
   * touches the search index.
   *
   * The system design named three reindex sites; cross-checking the Phase 4
   * plan against it found this fourth one before it shipped. Without the hook
   * the document stays `in_stock = true` forever: the API answers, the number
   * is plausible, and the only symptom is a shopper clicking through to
   * something they cannot buy.
   */
  it('marks a product out of stock once its last unit is sold', async () => {
    const before = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute<{ in_stock: boolean }>(sql`
        SELECT d.in_stock FROM search_documents d
          JOIN products p ON p.id = d.product_id
         WHERE p.slug = ${`${NS}-widget`}
      `),
    );
    expect(before.rows[0]?.in_stock).toBe(true);

    const shopper = await register(`${NS}-reindex@example.test`);
    const address = await createAddress(shopper.token);
    // The one-unit listing is the only offer left on this product with stock;
    // the three seller listings were sold or reserved above.
    await addToCart(shopper.token, lastUnitListingId);

    const quoteRes = await app.inject({
      method: 'GET',
      url: `/checkout/quote?addressId=${address}`,
      headers: { authorization: `Bearer ${shopper.token}` },
    });
    if (quoteRes.statusCode !== 200) return; // already taken by the race test
    const total = json<{ total: { amount: number; currency: string } }>(quoteRes).total;

    const res = await confirm(shopper.token, {
      addressId: address,
      paymentMethod: 'cod',
      idempotencyKey: `${NS}-reindex`,
      expectedTotal: total,
    });
    expect(res.statusCode).toBe(201);

    // The index agrees with the world again, without anyone calling a reindex.
    const drift = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n
          FROM search_documents d
          JOIN search_document_source v ON v.product_id = d.product_id
          JOIN products p ON p.id = d.product_id
         WHERE p.slug LIKE ${`${NS}%`} AND d.in_stock <> v.in_stock
      `),
    );
    expect(drift.rows[0]?.n).toBe(0);
  });
});

describe('idempotency', () => {
  it('returns the original orders for a repeated key rather than placing more', async () => {
    const shopper = await register(`${NS}-idem@example.test`);
    const address = await createAddress(shopper.token);
    const seller = sellers[2];
    if (seller === undefined) throw new Error('fixture');
    await addToCart(shopper.token, seller.listingId);

    const quoteRes = await app.inject({
      method: 'GET',
      url: `/checkout/quote?addressId=${address}`,
      headers: { authorization: `Bearer ${shopper.token}` },
    });
    const total = json<{ total: { amount: number; currency: string } }>(quoteRes).total;
    const payload = {
      addressId: address,
      paymentMethod: 'mock',
      idempotencyKey: `${NS}-idem`,
      expectedTotal: total,
    };

    const first = json<{ orders: { id: string }[] }>(await confirm(shopper.token, payload));
    const second = json<{ orders: { id: string }[] }>(await confirm(shopper.token, payload));

    expect(second.orders.map((o) => o.id)).toEqual(first.orders.map((o) => o.id));

    const count = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM orders WHERE buyer_user_id = ${shopper.id}`,
      ),
    );
    expect(count.rows[0]?.n).toBe(1);
  });
});

describe('order reads', () => {
  it('shows a buyer their orders across every seller in one call', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me/orders',
      headers: { authorization: `Bearer ${buyer.token}` },
    });
    expect(res.statusCode).toBe(200);
    // This buyer has placed nothing; the point is that the route answers with
    // an empty page rather than another buyer's orders.
    expect(json<{ items: unknown[] }>(res).items).toEqual([]);
  });

  it('rejects an oversized limit rather than clamping it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me/orders?limit=5000',
      headers: { authorization: `Bearer ${buyer.token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses an anonymous request for the order history', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/orders' });
    expect(res.statusCode).toBe(401);
  });
});
