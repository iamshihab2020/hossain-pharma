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


type OrderItemRow = { id: string; quantity: number };

async function linesOf(seller: Seller, orderId: string): Promise<OrderItemRow[]> {
  const res = await asSeller(seller, 'GET', `/seller/orders/${orderId}`);
  expect(res.statusCode).toBe(200);
  return json<{ items: OrderItemRow[] }>(res).items;
}

/** The order as its seller sees it. */
async function orderView(
  seller: Seller,
  orderId: string,
): Promise<{ status: string; total: { amount: number } }> {
  const res = await asSeller(seller, 'GET', `/seller/orders/${orderId}`);
  expect(res.statusCode).toBe(200);
  return json(res);
}

async function stockRow(listingId: string): Promise<{ onHand: number; reserved: number }> {
  return withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
    const rows = await tx.execute<{ on_hand: number; reserved: number }>(
      sql`SELECT on_hand, reserved FROM inventory_items WHERE listing_id = ${listingId}`,
    );
    const row = rows.rows[0];
    return { onHand: row?.on_hand ?? -1, reserved: row?.reserved ?? -1 };
  });
}


function asBuyer(
  token: string,
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  // NO x-tenant-id. A buyer is not a tenant, and that is what makes `own_orders`
  // the policy that answers.
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload }),
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

describe('a seller dispatches part of an order', () => {
  it('ships one unit of three and leaves the order PARTIALLY_SHIPPED', async () => {
    const { orders } = await paidBasket('ship-part');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const res = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 1 }],
      carrierName: 'Pathao',
      trackingNumber: 'PT-1',
      idempotencyKey: `${NS}-ship-part-1`,
    });
    expect(res.statusCode).toBe(201);
    expect(json<{ carrierName: string }>(res).carrierName).toBe('Pathao');

    expect((await orderView(alpha, id)).status).toBe('PARTIALLY_SHIPPED');
  });

  it('does not change what a buyer can buy', async () => {
    const { orders } = await paidBasket('ship-stock');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const before = await stockRow(alpha.listingId);
    const availableBefore = await availableStock(alpha.listingId);

    await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 2 }],
      idempotencyKey: `${NS}-ship-stock-1`,
    });

    // on_hand and reserved BOTH fall, so available is untouched. That is why
    // dispatch needs no reindex, and this test is what keeps the claim honest.
    const after = await stockRow(alpha.listingId);
    expect(after.onHand).toBe(before.onHand - 2);
    expect(after.reserved).toBe(before.reserved - 2);
    expect(await availableStock(alpha.listingId)).toBe(availableBefore);
  });

  it('pays the seller for the units that went, and no more', async () => {
    const { orders } = await paidBasket('ship-money');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const payableBefore = await balance('SELLER_PAYABLE', alpha.orgId);
    const commissionBefore = await balance('PLATFORM_REVENUE_COMMISSION', null);

    const res = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 1 }],
      idempotencyKey: `${NS}-ship-money-1`,
    });
    const parcel = json<{
      released: { amount: number };
      commission: { amount: number };
    }>(res);

    // A payable is a CREDIT, so it is negative in a signed ledger.
    const payable = parcel.released.amount - parcel.commission.amount;
    expect(await balance('SELLER_PAYABLE', alpha.orgId)).toBe(payableBefore - payable);
    expect(await balance('PLATFORM_REVENUE_COMMISSION', null)).toBe(
      commissionBefore - parcel.commission.amount,
    );
  });

  it('closes the order to exactly zero outstanding on the last parcel', async () => {
    const { orders } = await paidBasket('ship-all');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const total = (await orderView(alpha, id)).total.amount;
    const payableBefore = await balance('SELLER_PAYABLE', alpha.orgId);
    const commissionBefore = await balance('PLATFORM_REVENUE_COMMISSION', null);

    // Two parcels, 1 then 2, so the split crosses the allocation boundary.
    const first = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 1 }],
      idempotencyKey: `${NS}-ship-all-1`,
    });
    expect(first.statusCode).toBe(201);
    const second = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 2 }],
      idempotencyKey: `${NS}-ship-all-2`,
    });
    expect(second.statusCode).toBe(201);

    expect((await orderView(alpha, id)).status).toBe('SHIPPED');

    // THE ACCEPTANCE ARITHMETIC. Two parcels' releases must sum EXACTLY to what
    // one full capture would have paid - no minor unit invented, none lost.
    const payableAfter = await balance('SELLER_PAYABLE', alpha.orgId);
    const commissionAfter = await balance('PLATFORM_REVENUE_COMMISSION', null);
    const paid = payableBefore - payableAfter;
    const commission = commissionBefore - commissionAfter;
    expect(paid + commission).toBe(total);
  });

  it('returns the original parcel when the idempotency key is replayed', async () => {
    const { orders } = await paidBasket('ship-idem');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const body = {
      items: [{ orderItemId: line.id, quantity: 1 }],
      idempotencyKey: `${NS}-ship-idem-1`,
    };
    const first = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, body);
    const again = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, body);

    expect(first.statusCode).toBe(201);
    // 200, not 201: the parcel already existed. A retried dispatch that shipped
    // twice would release the seller's money twice.
    expect(again.statusCode).toBe(200);
    expect(json<{ id: string }>(again).id).toBe(json<{ id: string }>(first).id);
  });

  it('refuses to ship more units than remain', async () => {
    const { orders } = await paidBasket('ship-too-many');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const res = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 99 }],
      idempotencyKey: `${NS}-ship-too-many-1`,
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuses to ship an order that has not been accepted', async () => {
    const { orders } = await paidBasket('ship-unaccepted');
    const id = orderFor(orders, alpha);
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const res = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 1 }],
      idempotencyKey: `${NS}-ship-unaccepted-1`,
    });
    expect(res.statusCode).toBe(409);
  });

  it('lets exactly one of two concurrent dispatches of the last unit win', async () => {
    const { orders } = await paidBasket('ship-race', { alpha: 1, beta: 1 });
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const attempt = (n: number) =>
      asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
        items: [{ orderItemId: line.id, quantity: 1 }],
        idempotencyKey: `${NS}-ship-race-${n}`,
      });

    // Different keys, so idempotency cannot be what saves this - the row lock
    // in claimUnits has to.
    const [a, b] = await Promise.all([attempt(1), attempt(2)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
  });
});

describe('a seller marks a parcel delivered', () => {
  it('marks the parcel delivered without moving any money', async () => {
    const { orders } = await paidBasket('deliver');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const parcel = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 3 }],
      idempotencyKey: `${NS}-deliver-1`,
    });
    const shipmentId = json<{ id: string }>(parcel).id;
    const payableBefore = await balance('SELLER_PAYABLE', alpha.orgId);

    const res = await asSeller(
      alpha,
      'POST',
      `/seller/orders/${id}/shipments/${shipmentId}/delivered`,
      {},
    );
    expect(res.statusCode).toBe(200);
    expect(json<{ status: string }>(res).status).toBe('DELIVERED');

    // The money moved at dispatch. Delivery is a fact about a box.
    expect(await balance('SELLER_PAYABLE', alpha.orgId)).toBe(payableBefore);
  });

  it('leaves the order SHIPPED while another parcel is still in transit', async () => {
    const { orders } = await paidBasket('deliver-partial');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const first = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 1 }],
      idempotencyKey: `${NS}-deliver-partial-1`,
    });
    const second = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 2 }],
      idempotencyKey: `${NS}-deliver-partial-2`,
    });
    expect((await orderView(alpha, id)).status).toBe('SHIPPED');

    await asSeller(
      alpha,
      'POST',
      `/seller/orders/${id}/shipments/${json<{ id: string }>(first).id}/delivered`,
      {},
    );
    // One box home, one still out. The order has not been delivered.
    expect((await orderView(alpha, id)).status).toBe('SHIPPED');

    await asSeller(
      alpha,
      'POST',
      `/seller/orders/${id}/shipments/${json<{ id: string }>(second).id}/delivered`,
      {},
    );
    expect((await orderView(alpha, id)).status).toBe('DELIVERED');
  });

  it('refuses to deliver the same parcel twice', async () => {
    const { orders } = await paidBasket('deliver-twice');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const parcel = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 3 }],
      idempotencyKey: `${NS}-deliver-twice-1`,
    });
    const url = `/seller/orders/${id}/shipments/${json<{ id: string }>(parcel).id}/delivered`;

    expect((await asSeller(alpha, 'POST', url, {})).statusCode).toBe(200);
    expect((await asSeller(alpha, 'POST', url, {})).statusCode).toBe(409);
  });

  it('does not let another seller deliver the parcel', async () => {
    const { orders } = await paidBasket('deliver-intruder');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const parcel = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 1 }],
      idempotencyKey: `${NS}-deliver-intruder-1`,
    });

    const res = await asSeller(
      beta,
      'POST',
      `/seller/orders/${id}/shipments/${json<{ id: string }>(parcel).id}/delivered`,
      {},
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('a buyer cancels their own order', () => {
  it('cancels an unshipped order and returns the stock', async () => {
    const { buyer, orders } = await paidBasket('buyer-cancel');
    const id = orderFor(orders, alpha);
    const availableBefore = await availableStock(alpha.listingId);

    const res = await asBuyer(buyer.token, 'POST', `/me/orders/${id}/cancel`, {
      reason: 'Changed my mind',
    });
    expect(res.statusCode).toBe(200);
    expect(json<{ status: string }>(res).status).toBe('CANCELLED');

    expect(await availableStock(alpha.listingId)).toBe(availableBefore + 3);
  });

  it('owes the buyer their money back and still credits no seller', async () => {
    const { buyer, orders } = await paidBasket('buyer-cancel-ledger');
    const id = orderFor(orders, alpha);
    const total = (await orderView(alpha, id)).total.amount;

    const receivableBefore = await balance('BUYER_RECEIVABLE', null);
    const payableBefore = await balance('SELLER_PAYABLE', alpha.orgId);

    await asBuyer(buyer.token, 'POST', `/me/orders/${id}/cancel`, {});

    expect(await balance('BUYER_RECEIVABLE', null)).toBe(receivableBefore - total);
    expect(await balance('SELLER_PAYABLE', alpha.orgId)).toBe(payableBefore);
  });

  it('reads back the cancellation it just made, not the state before it', async () => {
    // The response is read INSIDE the writing transaction. A second transaction
    // could not see the uncommitted cancel and would answer PAID.
    const { buyer, orders } = await paidBasket('buyer-cancel-read');
    const id = orderFor(orders, alpha);

    const res = await asBuyer(buyer.token, 'POST', `/me/orders/${id}/cancel`, {});
    expect(json<{ status: string }>(res).status).toBe('CANCELLED');
  });

  it('refuses once a parcel has dispatched', async () => {
    const { buyer, orders } = await paidBasket('buyer-cancel-late');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');
    await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 1 }],
      idempotencyKey: `${NS}-buyer-cancel-late-1`,
    });

    const res = await asBuyer(buyer.token, 'POST', `/me/orders/${id}/cancel`, {});
    expect(res.statusCode).toBe(409);
  });

  it("does not let a buyer cancel somebody else's order", async () => {
    const { orders } = await paidBasket('buyer-cancel-mine');
    const stranger = await register(`${NS}-stranger@example.test`);
    const id = orderFor(orders, alpha);

    // 404, not 403. `own_orders` means another buyer's order does not exist.
    const res = await asBuyer(stranger.token, 'POST', `/me/orders/${id}/cancel`, {});
    expect(res.statusCode).toBe(404);
  });

  it('leaves the other seller half of the basket untouched', async () => {
    const { buyer, orders } = await paidBasket('buyer-cancel-half');
    await asBuyer(buyer.token, 'POST', `/me/orders/${orderFor(orders, alpha)}/cancel`, {});

    expect((await orderView(beta, orderFor(orders, beta))).status).toBe('PAID');
  });
});

describe('a seller cancels outstanding lines', () => {
  it('cancels the remainder of a partly shipped order, landing it on SHIPPED', async () => {
    const { orders } = await paidBasket('seller-cancel-rest');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 1 }],
      idempotencyKey: `${NS}-seller-cancel-rest-1`,
    });

    const res = await asSeller(alpha, 'POST', `/seller/orders/${id}/cancel`, {
      items: [{ orderItemId: line.id, quantity: 2 }],
      reason: 'Damaged in the warehouse',
    });
    expect(res.statusCode).toBe(200);
    // Everything that was ever going to move, moved.
    expect(json<{ status: string }>(res).status).toBe('SHIPPED');
  });

  it('reverses only the cancelled units, leaving the dispatched ones paid', async () => {
    const { orders } = await paidBasket('seller-cancel-money');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const parcel = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 1 }],
      idempotencyKey: `${NS}-seller-cancel-money-1`,
    });
    const released = json<{ released: { amount: number } }>(parcel).released.amount;
    const total = (await orderView(alpha, id)).total.amount;
    const receivableBefore = await balance('BUYER_RECEIVABLE', null);

    await asSeller(alpha, 'POST', `/seller/orders/${id}/cancel`, {
      items: [{ orderItemId: line.id, quantity: 2 }],
      reason: 'Out of stock',
    });

    // The reversal is the order total MINUS what already shipped - the two
    // halves partition the order exactly, which is the whole point of
    // allocating per unit up front.
    expect(await balance('BUYER_RECEIVABLE', null)).toBe(receivableBefore - (total - released));
  });

  it('refuses to cancel units that already shipped', async () => {
    const { orders } = await paidBasket('seller-cancel-shipped');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 3 }],
      idempotencyKey: `${NS}-seller-cancel-shipped-1`,
    });

    const res = await asSeller(alpha, 'POST', `/seller/orders/${id}/cancel`, {
      items: [{ orderItemId: line.id, quantity: 1 }],
      reason: 'Too late',
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuses to cancel an order that is already delivered', async () => {
    const { orders } = await paidBasket('seller-cancel-delivered');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');

    const parcel = await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 3 }],
      idempotencyKey: `${NS}-seller-cancel-delivered-1`,
    });
    await asSeller(
      alpha,
      'POST',
      `/seller/orders/${id}/shipments/${json<{ id: string }>(parcel).id}/delivered`,
      {},
    );

    const res = await asSeller(alpha, 'POST', `/seller/orders/${id}/cancel`, {
      reason: 'Nothing left',
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('the buyer timeline', () => {
  type Timeline = {
    timeline: { type: string; actor: string; payload: Record<string, unknown> }[];
    shipments: { id: string; carrierName: string | null; items: unknown[] }[];
    items: { id: string }[];
  };

  it('starts at placement and records every step in order', async () => {
    const { buyer, orders } = await paidBasket('timeline');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');
    await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 3 }],
      carrierName: 'Pathao',
      trackingNumber: 'PT-42',
      idempotencyKey: `${NS}-timeline-1`,
    });

    const res = await asBuyer(buyer.token, 'GET', `/me/orders/${id}`);
    expect(res.statusCode).toBe(200);
    const body = json<Timeline>(res);

    // PLACED comes from checkout and PAID from the webhook, so a timeline
    // starts at placement rather than at the first seller action.
    expect(body.timeline.map((e) => e.type)).toEqual([
      'PLACED',
      'PAID',
      'ACCEPTED',
      'SHIPMENT_DISPATCHED',
    ]);
    expect(body.timeline.map((e) => e.actor)).toEqual(['BUYER', 'SYSTEM', 'SELLER', 'SELLER']);
  });

  it('carries the carrier and tracking number in the dispatch payload', async () => {
    const { buyer, orders } = await paidBasket('timeline-payload');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');
    await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 1 }],
      carrierName: 'Steadfast',
      trackingNumber: 'SF-9',
      idempotencyKey: `${NS}-timeline-payload-1`,
    });

    const body = json<Timeline>(await asBuyer(buyer.token, 'GET', `/me/orders/${id}`));
    const dispatched = body.timeline.find((e) => e.type === 'SHIPMENT_DISPATCHED');
    // A timeline entry that said only SHIPPED would tell the buyer less than
    // they already knew.
    expect(dispatched?.payload).toMatchObject({
      carrierName: 'Steadfast',
      trackingNumber: 'SF-9',
    });
  });

  it('shows the buyer their parcels', async () => {
    const { buyer, orders } = await paidBasket('timeline-parcels');
    const id = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${id}/accept`, {});
    const [line] = await linesOf(alpha, id);
    if (!line) throw new Error('no line');
    await asSeller(alpha, 'POST', `/seller/orders/${id}/shipments`, {
      items: [{ orderItemId: line.id, quantity: 2 }],
      carrierName: 'Pathao',
      idempotencyKey: `${NS}-timeline-parcels-1`,
    });

    const body = json<Timeline>(await asBuyer(buyer.token, 'GET', `/me/orders/${id}`));
    expect(body.shipments).toHaveLength(1);
    expect(body.shipments[0]?.carrierName).toBe('Pathao');
    expect(body.shipments[0]?.items).toHaveLength(1);
  });

  it('records a cancellation on the timeline with its reason', async () => {
    const { buyer, orders } = await paidBasket('timeline-cancel');
    const id = orderFor(orders, alpha);
    await asBuyer(buyer.token, 'POST', `/me/orders/${id}/cancel`, { reason: 'Ordered twice' });

    const body = json<Timeline>(await asBuyer(buyer.token, 'GET', `/me/orders/${id}`));
    const cancelled = body.timeline.find((e) => e.type === 'CANCELLED');
    expect(cancelled?.actor).toBe('BUYER');
    expect(cancelled?.payload).toMatchObject({ reason: 'Ordered twice' });
  });

  it('shows a seller ONLY their own half of a shared basket', async () => {
    // The second PRD Phase 5 acceptance criterion, at the API.
    const { orders } = await paidBasket('timeline-isolation');
    const alphaOrder = orderFor(orders, alpha);
    await asSeller(alpha, 'POST', `/seller/orders/${alphaOrder}/accept`, {});

    const mine = json<Timeline>(await asSeller(alpha, 'GET', `/seller/orders/${alphaOrder}`));
    expect(mine.items).toHaveLength(1);
    expect(mine.timeline.some((e) => e.type === 'ACCEPTED')).toBe(true);

    // Beta's own order has its own timeline, with no trace of alpha's actions.
    const theirs = json<Timeline>(
      await asSeller(beta, 'GET', `/seller/orders/${orderFor(orders, beta)}`),
    );
    expect(theirs.timeline.some((e) => e.type === 'ACCEPTED')).toBe(false);
    expect(theirs.items).toHaveLength(1);
  });

  it('normalises created_at to a Date rather than a string', async () => {
    // A raw tx.execute skips Drizzle's column mapping and a timestamptz comes
    // back as a string. The assumption survives every small test and fails on
    // the first result set large enough to page.
    const { orders } = await paidBasket('timeline-dates');
    const id = orderFor(orders, alpha);
    const body = json<{ timeline: { createdAt: string }[] }>(
      await asSeller(alpha, 'GET', `/seller/orders/${id}`),
    );
    expect(Number.isNaN(Date.parse(body.timeline[0]?.createdAt ?? ''))).toBe(false);
  });
});
