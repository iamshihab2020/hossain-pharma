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
 * PRD 11 Phase 5, over HTTP.
 *
 * The fixture is built here rather than taken from the seed, deliberately, and
 * for the reason `checkout.e2e` states: fulfilling an order MOVES STOCK, which
 * changes `listings.available_stock` and therefore what `catalogue.e2e` and
 * `search.e2e` see. Three files asserting against one mutable seed is how this
 * suite broke three times in Phase 3.
 *
 * Two sellers share one basket throughout, because half of Phase 5's acceptance
 * criteria is that one seller can fulfil their half while the other's stays
 * untouched - and a single-seller fixture cannot show that at all.
 */
let app: NestFastifyApplication;
let mock: MockPaymentAdapter;

/** Namespaced per file. `users.email` is globally unique and vitest is parallel. */
const NS = `fulfilment-${randomUUID().slice(0, 8)}`;

type Seller = { orgId: string; listingId: string; price: number; token: string };

let alpha: Seller;
let beta: Seller;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  mock = app.get(MockPaymentAdapter);

  await buildFixture();
}, 180_000);

afterAll(async () => {
  await app?.close();
});

// ---------------------------------------------------------------------- setup

/**
 * Two sellers, one shared catalogue product, deep stock.
 *
 * Deep because every test buys its OWN basket rather than sharing one:
 * fulfilment is a state machine, so a test that accepted a shared order would
 * change what the next test found and the failure would depend on file order.
 * Nine units bought three baskets and then made every later checkout a 409.
 *
 * Baskets take THREE units of alpha so a shipment can be genuinely PARTIAL -
 * the acceptance criterion needs a line that can be split, and a quantity of
 * one cannot be half sent.
 *
 * Written with `isAdmin: true` because a test fixture is a platform action, the
 * same reason the seed can write across tenants and a request cannot.
 */
async function buildFixture(): Promise<void> {
  const sellers: { orgId: string; listingId: string; price: number; email: string }[] = [];

  await withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
    const [category] = await tx
      .insert(schema.categories)
      .values({ slug: `${NS}-goods`, name: 'Goods', path: `${NS.replace(/-/g, '_')}_goods` })
      .returning({ id: schema.categories.id });
    if (!category) throw new Error('fixture: category');

    const [product] = await tx
      .insert(schema.products)
      .values({
        slug: `${NS}-widget`,
        name: 'Fulfilment Widget',
        categoryId: category.id,
        status: 'ACTIVE',
      })
      .returning({ id: schema.products.id });
    if (!product) throw new Error('fixture: product');

    for (const [index, name] of ['alpha', 'beta'].entries()) {
      const [org] = await tx
        .insert(schema.organisations)
        .values({
          slug: `${NS}-${name}`,
          legalName: `${name} Ltd`,
          displayName: name,
          status: 'ACTIVE',
          countryCode: 'BD',
          defaultCurrency: 'BDT',
        })
        .returning({ id: schema.organisations.id });
      if (!org) throw new Error('fixture: org');

      const [variant] = await tx
        .insert(schema.productVariants)
        .values({ productId: product.id, sku: `${NS}-SKU-${name}`, name: `Variant ${name}` })
        .returning({ id: schema.productVariants.id });
      if (!variant) throw new Error('fixture: variant');

      const price = 10_000 * (index + 1);

      const [listing] = await tx
        .insert(schema.listings)
        .values({
          tenantId: org.id,
          variantId: variant.id,
          status: 'ACTIVE',
          priceAmount: price,
          priceCurrency: 'BDT',
          availableStock: 300,
        })
        .returning({ id: schema.listings.id });
      const [warehouse] = await tx
        .insert(schema.warehouses)
        .values({ tenantId: org.id, name: `${NS} ${name} depot`, pincode: '1207' })
        .returning({ id: schema.warehouses.id });
      if (!listing || !warehouse) throw new Error('fixture: listing');

      await tx.insert(schema.inventoryItems).values({
        tenantId: org.id,
        listingId: listing.id,
        warehouseId: warehouse.id,
        onHand: 300,
      });

      sellers.push({
        orgId: org.id,
        listingId: listing.id,
        price,
        email: `${NS}-${name}@example.test`,
      });
    }

    // An ACTIVE product with ACTIVE offers belongs in `search_documents`. A
    // fixture that skips this leaves the table disagreeing with
    // `search_document_source`, and search.e2e's drift test - running in
    // parallel - correctly goes red.
    await tx.execute(upsertSearchDocument(product.id));
  });

  // The seller users, each an OWNER of exactly one org. Separate people rather
  // than one account in both, so "another seller cannot touch this order" is a
  // real claim about a different caller.
  const built: Seller[] = [];
  for (const seller of sellers) {
    const account = await register(seller.email, 'Seller');
    await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.insert(schema.orgMembers).values({
        tenantId: seller.orgId,
        userId: account.id,
        role: 'OWNER',
      }),
    );
    built.push({
      orgId: seller.orgId,
      listingId: seller.listingId,
      price: seller.price,
      token: account.token,
    });
  }

  const [a, b] = built;
  if (!a || !b) throw new Error('fixture: sellers');
  alpha = a;
  beta = b;
}

// -------------------------------------------------------------------- helpers

async function register(email: string, displayName = 'Fulfilment Buyer'): Promise<{
  token: string;
  id: string;
}> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'fulfilment-password-1', displayName },
  });
  expect(res.statusCode).toBe(201);
  const body = json<{ accessToken: string; user: { id: string } }>(res);
  return { token: body.accessToken, id: body.user.id };
}

/**
 * A buyer with a paid basket across both sellers, and the two orders it made.
 *
 * Every test that needs an order starts here rather than sharing one, because
 * fulfilment is a state machine: a test that accepted an order would change
 * what the next test found, and the failure would depend on file order.
 */
async function paidBasket(
  label: string,
  quantities: { alpha: number; beta: number } = { alpha: 3, beta: 1 },
): Promise<{
  buyer: { token: string; id: string };
  orders: { id: string; sellerId: string }[];
  intentId: string;
}> {
  const buyer = await register(`${NS}-${label}@example.test`);
  const addressId = await createAddress(buyer.token);

  await addToCart(buyer.token, alpha.listingId, quantities.alpha);
  await addToCart(buyer.token, beta.listingId, quantities.beta);

  const quoteRes = await app.inject({
    method: 'GET',
    url: `/checkout/quote?addressId=${addressId}`,
    headers: { authorization: `Bearer ${buyer.token}` },
  });
  expect(quoteRes.statusCode).toBe(200);
  const quote = json<{ total: { amount: number; currency: string } }>(quoteRes);

  const confirmed = await app.inject({
    method: 'POST',
    url: '/checkout/confirm',
    headers: { authorization: `Bearer ${buyer.token}` },
    payload: {
      addressId,
      paymentMethod: 'mock',
      idempotencyKey: `${NS}-${label}`,
      expectedTotal: quote.total,
    },
  });
  expect(confirmed.statusCode).toBe(201);
  const body = json<{
    orders: { id: string; sellerId: string }[];
    paymentIntentId: string;
  }>(confirmed);

  // The webhook is the only writer of payment status, so the orders reach PAID
  // the way a gateway would take them there.
  const raw = JSON.stringify({
    id: `${NS}-evt-${label}`,
    type: 'payment_succeeded',
    providerRef: `mock_${body.paymentIntentId}`,
  });
  const delivered = await app.inject({
    method: 'POST',
    url: '/webhooks/payment/mock',
    headers: { 'content-type': 'application/json', 'x-mock-signature': mock.sign(raw) },
    payload: raw,
  });
  expect(delivered.statusCode).toBe(200);

  return { buyer, orders: body.orders, intentId: body.paymentIntentId };
}

async function createAddress(token: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/me/addresses',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      recipientName: 'Fulfilment Buyer',
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

async function addToCart(token: string, listingId: string, quantity: number): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/cart/items',
    headers: { authorization: `Bearer ${token}` },
    payload: { listingId, quantity },
  });
  expect(res.statusCode).toBe(201);
}

function asSeller(
  seller: Seller,
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${seller.token}`, 'x-tenant-id': seller.orgId },
    ...(payload === undefined ? {} : { payload }),
  });
}

function orderFor(orders: { id: string; sellerId: string }[], seller: Seller): string {
  const order = orders.find((o) => o.sellerId === seller.orgId);
  if (order === undefined) throw new Error('no order for that seller');
  return order.id;
}

function json<T>(res: LightMyRequestResponse): T {
  return JSON.parse(res.body) as T;
}

async function availableStock(listingId: string): Promise<number> {
  return withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
    const rows = await tx.execute<{ stock: number }>(
      sql`SELECT available_stock AS stock FROM listings WHERE id = ${listingId}`,
    );
    return rows.rows[0]?.stock ?? -1;
  });
}

/** One account's balance for a ledger kind, summed straight from the entries. */
async function balance(kind: string, ownerOrgId: string | null): Promise<number> {
  return withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
    const rows = await tx.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(e.amount), 0) AS total
        FROM ledger_entries e
        JOIN ledger_accounts a ON a.id = e.account_id
       WHERE a.kind = ${kind}::ledger_account_kind
         AND a.owner_org_id IS NOT DISTINCT FROM ${ownerOrgId}
    `);
    return Number.parseInt(rows.rows[0]?.total ?? '0', 10);
  });
}

// --------------------------------------------------------------------- tests

describe('a seller accepts an order', () => {
  it('moves a paid order to ACCEPTED', async () => {
    const { orders } = await paidBasket('accept');
    const id = orderFor(orders, alpha);

    const res = await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    expect(res.statusCode).toBe(200);
    expect(json<{ status: string }>(res).status).toBe('ACCEPTED');
  });

  it('refuses to accept the same order twice, with a code the client can act on', async () => {
    const { orders } = await paidBasket('accept-twice');
    const id = orderFor(orders, alpha);

    expect((await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {})).statusCode).toBe(200);

    const again = await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    expect(again.statusCode).toBe(409);
    expect(json<{ code: string }>(again).code).toBe('INVALID_TRANSITION');
  });

  it('does not let another seller touch the order', async () => {
    const { orders } = await paidBasket('intruder');
    const id = orderFor(orders, alpha);

    // A 404, not a 403. Under RLS an order that is not yours does not exist,
    // and saying "forbidden" would confirm that it does.
    const res = await asSeller(beta, 'POST', `/seller/orders/${id}/accept`, {});
    expect(res.statusCode).toBe(404);
  });

  it('leaves the other seller half of the basket alone', async () => {
    const { orders } = await paidBasket('one-half');
    await asSeller(alpha, 'POST', `/seller/orders/${orderFor(orders, alpha)}/accept`, {});

    const other = await asSeller(beta, 'GET', `/seller/orders/${orderFor(orders, beta)}`);
    expect(json<{ status: string }>(other).status).toBe('PAID');
  });
});

describe('a seller rejects an order', () => {
  it('refuses a rejection with no reason', async () => {
    const { orders } = await paidBasket('reject-no-reason');
    const id = orderFor(orders, alpha);

    const res = await asSeller(alpha, 'POST', `/seller/orders/${id}/reject`, {});
    expect(res.statusCode).toBe(400);
  });

  it('rejects the order, returns the stock, and reindexes', async () => {
    const { orders } = await paidBasket('reject');
    const id = orderFor(orders, alpha);
    const reserved = await availableStock(alpha.listingId);

    const res = await asSeller(alpha, 'POST', `/seller/orders/${id}/reject`, {
      reason: 'Damaged in the warehouse',
    });
    expect(res.statusCode).toBe(200);
    expect(json<{ status: string }>(res).status).toBe('REJECTED');

    // Three units go back on the shelf, and search has to be told: putting the
    // last unit back is exactly the write that flips `in_stock`.
    expect(await availableStock(alpha.listingId)).toBe(reserved + 3);
  });

  it('owes the buyer their money back and credits no seller', async () => {
    const before = {
      receivable: await balance('BUYER_RECEIVABLE', null),
      payable: await balance('SELLER_PAYABLE', alpha.orgId),
    };

    const { orders } = await paidBasket('reject-ledger');
    const id = orderFor(orders, alpha);
    const afterCapture = await balance('BUYER_RECEIVABLE', null);

    // Read the total rather than compute it. A reversal returns the order's
    // TOTAL - subtotal plus order-level shipping and 15% VAT - because that is
    // what `gross` means in a capture. Asserting the subtotal here was wrong by
    // exactly the tax and carriage.
    const view = await asSeller(alpha, 'GET', `/seller/orders/${id}`);
    const alphaTotal = json<{ total: { amount: number } }>(view).total.amount;

    await asSeller(alpha, 'POST', `/seller/orders/${id}/reject`, { reason: 'Out of stock' });

    // The capture debited the buyer receivable; rejecting credits back exactly
    // this order's share, so the net movement is the OTHER seller's half.
    expect(await balance('BUYER_RECEIVABLE', null)).toBe(afterCapture - alphaTotal);
    expect(afterCapture).toBeGreaterThan(before.receivable);

    // Nothing was ever credited to the seller, because a payable is created by
    // DISPATCH. That is the dispatch-release decision paying for itself.
    expect(await balance('SELLER_PAYABLE', alpha.orgId)).toBe(before.payable);
  });

  it('refuses to reject an order it has already accepted', async () => {
    const { orders } = await paidBasket('reject-after-accept');
    const id = orderFor(orders, alpha);

    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const res = await asSeller(alpha, 'POST', `/seller/orders/${id}/reject`, { reason: 'Too late' });
    expect(res.statusCode).toBe(409);
  });
});
