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

/**
 * PRD 9.1's cart: one cart, many sellers, server-authoritative, with a guest
 * cart that merges on login.
 *
 * Own fixtures, own namespace. This file adds and removes cart lines against
 * listings it created, so it cannot disturb what catalogue.e2e or search.e2e
 * assert about the seed.
 */
let app: NestFastifyApplication;

const NS = `cart-${randomUUID().slice(0, 8)}`;
let listingA: string;
let listingB: string;
let pausedListing: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  await withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
    const [category] = await tx
      .insert(schema.categories)
      .values({ slug: `${NS}-cat`, name: 'Cart goods', path: NS.replace(/-/g, '_') })
      .returning({ id: schema.categories.id });
    if (!category) throw new Error('fixture');

    const [product] = await tx
      .insert(schema.products)
      .values({ slug: `${NS}-p`, name: 'Cart Widget', categoryId: category.id, status: 'ACTIVE' })
      .returning({ id: schema.products.id });
    if (!product) throw new Error('fixture');

    const made: string[] = [];
    for (const [index, status] of (['ACTIVE', 'ACTIVE', 'PAUSED'] as const).entries()) {
      const [org] = await tx
        .insert(schema.organisations)
        .values({
          slug: `${NS}-org-${index}`,
          legalName: `Cart Seller ${index}`,
          displayName: `Cart Seller ${index}`,
          status: 'ACTIVE',
          countryCode: 'BD',
          defaultCurrency: 'BDT',
        })
        .returning({ id: schema.organisations.id });
      const [variant] = await tx
        .insert(schema.productVariants)
        .values({ productId: product.id, sku: `${NS}-SKU-${index}`, name: `V${index}` })
        .returning({ id: schema.productVariants.id });
      if (!org || !variant) throw new Error('fixture');

      const [listing] = await tx
        .insert(schema.listings)
        .values({
          tenantId: org.id,
          variantId: variant.id,
          status,
          priceAmount: 25_000,
          priceCurrency: 'BDT',
          availableStock: 5,
        })
        .returning({ id: schema.listings.id });
      if (!listing) throw new Error('fixture');
      made.push(listing.id);
    }

    const [a, b, paused] = made;
    if (!a || !b || !paused) throw new Error('fixture');
    listingA = a;
    listingB = b;
    pausedListing = paused;

    // Index the fixture, as the seed does. An ACTIVE product with an ACTIVE
    // offer belongs in `search_documents`, and search.e2e's drift test runs in
    // parallel and compares that table to the view it is built from.
    await tx.execute(upsertSearchDocument(product.id));
  });
}, 180_000);

afterAll(async () => {
  await app?.close();
});

function json<T>(res: LightMyRequestResponse): T {
  return JSON.parse(res.body) as T;
}

/** The guest cookie a browser would carry between requests. */
function cookieFrom(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw ?? ''];
  const cart = list.find((c) => c.startsWith('nexmarket_cart='));
  if (cart === undefined) throw new Error('expected a cart cookie');
  return cart.split(';')[0] ?? '';
}

async function register(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'cart-password-123', displayName: 'Cart Buyer' },
  });
  expect(res.statusCode).toBe(201);
  return json<{ accessToken: string }>(res).accessToken;
}

type CartBody = {
  id: string;
  itemCount: number;
  subtotal: { amount: number; currency: string };
  hasUnavailableLines: boolean;
  groups: {
    sellerName: string;
    subtotal: { amount: number };
    lines: {
      id: string;
      quantity: number;
      available: boolean;
      unavailableReason: string | null;
      unitPrice: { amount: number };
    }[];
  }[];
};

describe('the cart holds no prices', () => {
  /**
   * PRD 9.1: "Server-authoritative pricing - client never sends a price."
   *
   * Asserted against the SCHEMA rather than against behaviour. A test that only
   * checked the response would still pass on the day someone added a
   * `unit_price` column "for convenience", and that column is the whole attack
   * surface this design removes.
   */
  it('has no money column on cart_items, by reflection', async () => {
    const rows = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute<{ column_name: string }>(sql`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'cart_items'
      `),
    );
    const names = rows.rows.map((r) => r.column_name);
    expect(names).toEqual(
      expect.arrayContaining(['id', 'cart_id', 'listing_id', 'quantity']),
    );
    for (const name of names) {
      expect(name).not.toMatch(/price|amount|total|currency/);
    }
  });

  it('ignores a price a client tries to send', async () => {
    const token = await register(`${NS}-tamper@example.test`);
    const res = await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { listingId: listingA, quantity: 1, unitPrice: { amount: 1, currency: 'BDT' } },
    });
    expect(res.statusCode).toBe(201);
    // The listing's real price, not the one in the body.
    expect(json<CartBody>(res).subtotal.amount).toBe(25_000);
  });
});

describe('a guest cart', () => {
  it('mints a cookie and survives across requests', async () => {
    const first = await app.inject({ method: 'POST', url: '/cart/items', payload: { listingId: listingA } });
    expect(first.statusCode).toBe(201);
    const cookie = cookieFrom(first);

    const second = await app.inject({ method: 'GET', url: '/cart', headers: { cookie } });
    expect(json<CartBody>(second).itemCount).toBe(1);
  });

  it('stores the token HASHED, never in the clear', async () => {
    const res = await app.inject({ method: 'POST', url: '/cart/items', payload: { listingId: listingA } });
    const token = cookieFrom(res).split('=')[1] ?? '';
    expect(token.length).toBeGreaterThan(20);

    const rows = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM carts WHERE token_hash = ${token}`,
      ),
    );
    // The raw token must match nothing: a database dump is not a set of live
    // cart handles. Same treatment sessions gives refresh tokens.
    expect(rows.rows[0]?.n).toBe(0);
  });

  it('sums quantities when the same listing is added twice', async () => {
    const first = await app.inject({ method: 'POST', url: '/cart/items', payload: { listingId: listingA, quantity: 2 } });
    const cookie = cookieFrom(first);
    const second = await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { cookie },
      payload: { listingId: listingA, quantity: 3 },
    });
    expect(json<CartBody>(second).itemCount).toBe(5);
  });
});

describe('grouping and availability', () => {
  it('groups by seller with a per-seller subtotal', async () => {
    const token = await register(`${NS}-groups@example.test`);
    await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { listingId: listingA, quantity: 2 },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { listingId: listingB, quantity: 1 },
    });

    const body = json<CartBody>(res);
    expect(body.groups).toHaveLength(2);
    expect(body.groups.map((g) => g.subtotal.amount).sort((a, b) => a - b)).toEqual([25_000, 50_000]);
    expect(body.subtotal.amount).toBe(75_000);
  });

  it('refuses to add a PAUSED offer, because it is not publicly on sale', async () => {
    const res = await app.inject({ method: 'POST', url: '/cart/items', payload: { listingId: pausedListing } });
    // `public_active_offers` is what decides, not a check in the handler: with
    // no tenant selected the row simply is not there.
    expect(res.statusCode).toBe(404);
  });

  it('keeps a line whose offer was paused AFTER it was added, and flags it', async () => {
    const first = await app.inject({ method: 'POST', url: '/cart/items', payload: { listingId: listingB } });
    const cookie = cookieFrom(first);

    await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute(sql`UPDATE listings SET status = 'PAUSED' WHERE id = ${listingB}`),
    );

    const res = await app.inject({ method: 'GET', url: '/cart', headers: { cookie } });
    const body = json<CartBody>(res);
    expect(body.hasUnavailableLines).toBe(true);
    const line = body.groups.flatMap((g) => g.lines)[0];
    // Flagged, not silently dropped. A cart that quietly loses items is a
    // support ticket nobody can reproduce.
    expect(line?.available).toBe(false);
    expect(line?.unavailableReason).toBe('This offer is no longer available');
    expect(body.subtotal.amount).toBe(0);

    await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx.execute(sql`UPDATE listings SET status = 'ACTIVE' WHERE id = ${listingB}`),
    );
  });
});

describe('merge on login', () => {
  it('sums quantities into the member cart and is a no-op second time', async () => {
    const guest = await app.inject({ method: 'POST', url: '/cart/items', payload: { listingId: listingA, quantity: 2 } });
    const cookie = cookieFrom(guest);

    const token = await register(`${NS}-merge@example.test`);
    await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { listingId: listingA, quantity: 1 },
    });

    const merged = await app.inject({
      method: 'POST',
      url: '/cart/merge',
      headers: { authorization: `Bearer ${token}`, cookie },
    });
    // PRD 9.1: "quantity-summed, not overwritten". 1 member + 2 guest = 3.
    expect(json<CartBody>(merged).itemCount).toBe(3);

    const again = await app.inject({
      method: 'POST',
      url: '/cart/merge',
      headers: { authorization: `Bearer ${token}`, cookie },
    });
    // The guest cart is MERGED, not deleted, so a re-submit finds nothing
    // ACTIVE to fold in rather than doubling the quantities.
    expect(json<CartBody>(again).itemCount).toBe(3);
  });

  it('refuses to merge without a signed-in user', async () => {
    const res = await app.inject({ method: 'POST', url: '/cart/merge' });
    expect(res.statusCode).toBe(401);
  });
});

describe('one shopper cannot touch another cart', () => {
  it('404s when removing a line from someone else cart', async () => {
    const mine = await register(`${NS}-mine@example.test`);
    const theirs = await register(`${NS}-theirs@example.test`);

    const added = await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: `Bearer ${mine}` },
      payload: { listingId: listingA },
    });
    const lineId = json<CartBody>(added).groups[0]?.lines[0]?.id;
    expect(lineId).toBeDefined();

    const res = await app.inject({
      method: 'DELETE',
      url: `/cart/items/${lineId}`,
      headers: { authorization: `Bearer ${theirs}` },
    });
    // 404 rather than 403: confirming the line exists is itself the leak.
    expect(res.statusCode).toBe(404);
  });

  it('rejects an expired or forged token instead of quietly serving a guest cart', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/cart',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    // Downgrading a member to a guest here loses their cart and looks like
    // data loss to them.
    expect(res.statusCode).toBe(401);
  });
});

describe('the address book', () => {
  it('makes the first address the default, and moves the default on request', async () => {
    const token = await register(`${NS}-addr@example.test`);
    const payload = {
      recipientName: 'A Buyer',
      phone: '+8801700000000',
      line1: '1 Road',
      city: 'Dhaka',
      district: 'Dhaka',
      postcode: '1207',
      countryCode: 'BD',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/me/addresses',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(json<{ isDefaultShipping: boolean }>(first).isDefaultShipping).toBe(true);

    const second = await app.inject({
      method: 'POST',
      url: '/me/addresses',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, line1: '2 Road', isDefaultShipping: true },
    });
    expect(json<{ isDefaultShipping: boolean }>(second).isDefaultShipping).toBe(true);

    const list = await app.inject({
      method: 'GET',
      url: '/me/addresses',
      headers: { authorization: `Bearer ${token}` },
    });
    const items = json<{ items: { isDefaultShipping: boolean }[] }>(list).items;
    // Exactly one default, always. Two would make checkout's choice arbitrary.
    expect(items.filter((a) => a.isDefaultShipping)).toHaveLength(1);
  });

  it('rejects a postcode that is not four digits', async () => {
    const token = await register(`${NS}-postcode@example.test`);
    const res = await app.inject({
      method: 'POST',
      url: '/me/addresses',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        recipientName: 'A Buyer',
        phone: '+8801700000000',
        line1: '1 Road',
        city: 'Dhaka',
        district: 'Dhaka',
        postcode: 'NOPE',
        countryCode: 'BD',
      },
    });
    // Phase 6 resolves this to a delivery zone. Accepting anything now means a
    // table of addresses that cannot be shipped to, found two phases later.
    expect(res.statusCode).toBe(400);
  });

  it('404s on another user address for read, update and delete alike', async () => {
    const owner = await register(`${NS}-owner@example.test`);
    const stranger = await register(`${NS}-stranger@example.test`);

    const created = await app.inject({
      method: 'POST',
      url: '/me/addresses',
      headers: { authorization: `Bearer ${owner}` },
      payload: {
        recipientName: 'Owner',
        phone: '+8801700000000',
        line1: '1 Road',
        city: 'Dhaka',
        district: 'Dhaka',
        postcode: '1207',
        countryCode: 'BD',
      },
    });
    const id = json<{ id: string }>(created).id;

    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({
        method,
        url: `/me/addresses/${id}`,
        headers: { authorization: `Bearer ${stranger}` },
        ...(method === 'PATCH' ? { payload: { city: 'Elsewhere' } } : {}),
      });
      expect(res.statusCode, `${method} leaked`).toBe(404);
    }

    // And the row is untouched, not merely unreported.
    const still = await app.inject({
      method: 'GET',
      url: `/me/addresses/${id}`,
      headers: { authorization: `Bearer ${owner}` },
    });
    expect(json<{ city: string }>(still).city).toBe('Dhaka');
  });
});
