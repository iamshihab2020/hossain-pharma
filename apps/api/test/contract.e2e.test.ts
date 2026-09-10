import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import { endpoints, cartViewSchema, quoteSchema, type Endpoint } from '@nexmarket/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';

/**
 * THE CONTRACT, ASSERTED AGAINST THE REAL SERVER.
 *
 * `@nexmarket/api-client` declares the shape of every response the storefront
 * consumes, and the web app parses through those schemas. That only means
 * anything if something checks the schemas describe THIS server - otherwise the
 * package is a hand-written mirror with extra steps, and it drifts exactly like
 * the file it replaced.
 *
 * So: every endpoint below is called for real and its body is parsed. A field
 * renamed in a service, a `Date` that starts arriving as an object, a bare
 * array where the caller expected `{ items }` - each fails here, on the side
 * that caused it, rather than as an `undefined` three components deep in a page
 * nobody has opened yet.
 *
 * `.parse()` rather than `.safeParse()` on purpose: zod's thrown error names
 * the exact path that broke, which is the message worth having at 2am.
 *
 * Emails are namespaced `contract-` per the suite convention - vitest runs
 * these files in parallel against one database and `users.email` is globally
 * unique.
 */
let app: NestFastifyApplication;

const PASSWORD = 'contract-suite-password';

/** Seeded by `packages/db/src/seed/demo.ts`: four sellers on one variant. */
const DEMO_PRODUCT = 'redmi-note-14-5g';

type Session = { accessToken: string; userId: string };
let buyer: Session;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  buyer = await register('contract-buyer@example.test');
}, 180_000);

afterAll(async () => {
  await app.close();
});

async function register(email: string): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: PASSWORD, displayName: 'Contract Buyer' },
  });
  if (res.statusCode !== 201 && res.statusCode !== 200) {
    throw new Error(`register failed: ${String(res.statusCode)} ${res.body}`);
  }
  const body = res.json<{ accessToken: string; user: { id: string } }>();
  return { accessToken: body.accessToken, userId: body.user.id };
}

function auth(session: Session): Record<string, string> {
  return { authorization: `Bearer ${session.accessToken}` };
}

/**
 * Calls an endpoint and parses it through its own schema.
 *
 * Takes the `Endpoint` rather than a URL string, so the PATH is covered too: a
 * route the package points at incorrectly fails here as a 404 instead of
 * quietly never being exercised.
 */
async function conforms<T>(
  descriptor: Endpoint<T>,
  init: { headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await app.inject({
    method: 'GET',
    url: descriptor.path,
    ...(init.headers === undefined ? {} : { headers: init.headers }),
  });
  expect(res.statusCode, `${descriptor.path} -> ${res.body}`).toBe(200);
  return descriptor.schema.parse(res.json());
}

describe('public catalogue', () => {
  it('GET /categories', async () => {
    const body = await conforms(endpoints.categories());
    expect(body.items.length).toBeGreaterThan(0);
    // The tree is recursive, and a schema that only ever saw leaves would not
    // prove `children` parses. Electronics has descendants in the seed.
    expect(body.items.some((node) => node.children.length > 0)).toBe(true);
  });

  it('GET /categories/:slug/products', async () => {
    const body = await conforms(endpoints.categoryProducts('smartphones'));
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('GET /products/:slug', async () => {
    const product = await conforms(endpoints.product(DEMO_PRODUCT));
    expect(product.slug).toBe(DEMO_PRODUCT);

    const variant = product.variants.find((v) => v.sku === 'RN14-8-256-BLK');
    expect(variant).toBeDefined();
    // The demo market exists so the comparison has something to compare. If
    // this drops to one, the storefront's whole thesis has nothing to show.
    expect(variant?.buyBox.offers.length).toBeGreaterThanOrEqual(4);
    expect(variant?.buyBox.basis).toBe('flat-shipping');
  });

  it('ranks the buy box on LANDED price, which the seed makes non-obvious', async () => {
    const product = await conforms(endpoints.product(DEMO_PRODUCT));
    const buyBox = product.variants.find((v) => v.sku === 'RN14-8-256-BLK')?.buyBox;
    const winner = buyBox?.winner;
    expect(winner).toBeDefined();

    const cheapestSticker = [...(buyBox?.offers ?? [])].sort(
      (a, b) => a.price.amount - b.price.amount,
    )[0];

    // The point of the fixture: the cheapest STICKER price does not win, and a
    // buy box that ignored shipping would pass every other assertion here.
    expect(cheapestSticker?.listingId).not.toBe(winner?.listingId);
    for (const offer of buyBox?.offers ?? []) {
      expect(offer.landedPrice.amount).toBeGreaterThanOrEqual(winner?.landedPrice.amount ?? 0);
    }
  });

  it('GET /search', async () => {
    const body = await conforms(endpoints.search({ q: 'redmi' }));
    expect(body.items.some((hit) => hit.slug === DEMO_PRODUCT)).toBe(true);
  });

  it('GET /search sorted by sellers, which the home rail depends on', async () => {
    const body = await conforms(endpoints.search({ sort: 'sellers', limit: 8, inStock: true }));
    const counts = body.items.map((hit) => hit.sellerCount);
    // Descending, or the rail is titled "where sellers compete" and ordered by
    // something else.
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it('GET /search/suggest', async () => {
    const body = await conforms(endpoints.suggest('red'));
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('GET /products/:slug/similar returns SEARCH HITS, not product summaries', async () => {
    // These two shapes look alike and are not the same. The first hand-written
    // version of the web types had this wrong.
    const body = await conforms(endpoints.similar(DEMO_PRODUCT));
    for (const hit of body.items) expect(hit).toHaveProperty('productId');
  });
});

describe('cart', () => {
  it('GET /cart and POST /cart/items conform for a guest', async () => {
    const product = await conforms(endpoints.product(DEMO_PRODUCT));
    const listingId = product.variants[0]?.buyBox.winner?.listingId;
    expect(listingId).toBeDefined();

    const added = await app.inject({
      method: 'POST',
      url: endpoints.cartItems().path,
      payload: { listingId, quantity: 2 },
    });
    expect(added.statusCode).toBe(201);
    const cart = cartViewSchema.parse(added.json());
    expect(cart.itemCount).toBe(2);
    expect(cart.groups.length).toBe(1);

    // The guest cookie the API mints is what the web BFF adopts in its
    // add-to-cart action. If it stops being set, the storefront silently gives
    // every guest a fresh empty cart on every request.
    const cookie = added.cookies.find((c) => c.name === 'nexmarket_cart');
    expect(cookie?.value).toBeTruthy();

    const reread = await app.inject({
      method: 'GET',
      url: endpoints.cart().path,
      headers: { cookie: `nexmarket_cart=${String(cookie?.value)}` },
    });
    expect(cartViewSchema.parse(reread.json()).itemCount).toBe(2);
  });
});

describe('authenticated reads', () => {
  it('GET /me/addresses, and POST returns a bare address', async () => {
    const created = await app.inject({
      method: 'POST',
      url: endpoints.createAddress().path,
      headers: auth(buyer),
      payload: {
        recipientName: 'Contract Buyer',
        phone: '+8801700000000',
        line1: '12 Elephant Road',
        city: 'Dhaka',
        district: 'Dhaka',
        postcode: '1205',
        countryCode: 'BD',
      },
    });
    expect(created.statusCode).toBe(201);
    endpoints.createAddress().schema.parse(created.json());

    const list = await conforms(endpoints.addresses(), { headers: auth(buyer) });
    expect(list.items.length).toBe(1);
    // First address is the default, and the storefront preselects it at
    // checkout rather than asking a question with one possible answer.
    expect(list.items[0]?.isDefaultShipping).toBe(true);
  });

  it('GET /me/orders is an empty page for a new buyer', async () => {
    const body = await conforms(endpoints.orders(), { headers: auth(buyer) });
    expect(body.items).toEqual([]);
    // Present and null, not absent. A missing cursor field would make "is there
    // more?" undefined rather than false.
    expect(body.nextCursor).toBeNull();
  });

  it('GET /checkout/quote conforms once a cart and an address exist', async () => {
    const product = await conforms(endpoints.product(DEMO_PRODUCT));
    const listingId = product.variants[0]?.buyBox.winner?.listingId;

    await app.inject({
      method: 'POST',
      url: endpoints.cartItems().path,
      headers: auth(buyer),
      payload: { listingId, quantity: 1 },
    });

    const addresses = await conforms(endpoints.addresses(), { headers: auth(buyer) });
    const addressId = addresses.items[0]?.id;
    expect(addressId).toBeDefined();

    const res = await app.inject({
      method: 'GET',
      url: endpoints.quote(String(addressId)).path,
      headers: auth(buyer),
    });
    expect(res.statusCode, res.body).toBe(200);
    const quote = quoteSchema.parse(res.json());

    // The quote is what the confirm request must match exactly, so its total
    // has to be a real sum rather than a placeholder the schema would accept.
    expect(quote.total.amount).toBeGreaterThan(0);
    expect(quote.groups.length).toBeGreaterThan(0);
  });
});

describe('error bodies', () => {
  it('a 404 still carries a parseable body', async () => {
    const res: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: endpoints.product('no-such-product-contract-suite').path,
    });
    expect(res.statusCode).toBe(404);
    // The web BFF turns this into an ApiError and reads `code` off it. A body
    // that is not an object at all would make that read throw.
    expect(typeof res.json()).toBe('object');
  });
});
