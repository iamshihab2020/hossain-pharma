import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';
import { AUTH_REQUIRED } from '../src/common/guards/auth.guard.js';

/**
 * PRD 6.4 criterion 1, proved by REFLECTION over the router rather than by a
 * hand-maintained list.
 *
 * A list of protected routes rots the first time someone adds a controller and
 * forgets to update it - and it rots silently, in the direction of an open
 * endpoint. This enumerates what Fastify actually registered and probes every
 * one of them unauthenticated.
 *
 * The only hand-maintained thing here is the PUBLIC allowlist, and that is
 * deliberate: it is short, every entry needs a reason, and a new @Public()
 * route fails this test until someone writes that reason down.
 */
let app: NestFastifyApplication;
const registered: { method: string; url: string }[] = [];

/**
 * Routes that must answer without a token, each with the reason it must.
 *
 * `/health` - a liveness probe runs before anything has a token, and a health
 *   endpoint that needs authentication cannot report that auth is broken.
 * `/auth/register`, `/auth/login` - there is no caller identity yet.
 * `/auth/refresh` - the caller presents a refresh COOKIE, not a bearer token;
 *   requiring an access token would defeat the point of refreshing after one
 *   expires.
 * `/auth/logout` - must work with an expired access token, or a stale tab can
 *   never sign out.
 * `/auth/google`, `/auth/google/callback` - the browser arrives from Google
 *   carrying no header of ours at all.
 * `/search`, `/search/suggest`, `/products/:slug/similar` - discovery. Same
 *   reason as the catalogue below: a marketplace nobody can search without an
 *   account is a marketplace nobody finds. `search_documents` holds only ACTIVE
 *   products that already have a public page.
 * `/categories`, `/categories/:slug/products`, `/products/:slug` - the buyer
 *   catalogue. A marketplace product page that requires a login is not a
 *   marketplace product page, and PRD 9.1 has anonymous discovery as the entry
 *   point to everything else. What an anonymous reader can SEE is limited in
 *   the database, by the `public_active_offers` policy in migration 0008, not
 *   by these handlers.
 * `/serviceability` - PRD 8.4 puts a delivery estimate and a serviceability
 *   check on the product page BEFORE add-to-cart, for a visitor who has not
 *   signed in, has no address book and has chosen no seller. Every table it
 *   reads (delivery_zones, serviceability, zone_rates) is platform-owned and
 *   carries no RLS, and none of them describes a person - a postcode-to-zone
 *   map is public geography, which is why it can answer without a token
 *   without exposing anything a caller did not already supply.
 * `/delivery-slots` - the other half of the same answer. A buyer choosing a
 *   delivery window is choosing courier capacity in a REGION, which belongs to
 *   no seller and names no person. It exposes REMAINING capacity rather than
 *   `booked`, so it leaks nothing about how many other people ordered.
 * `/products/:productId/reviews`, `/products/:productId/reviews/summary` -
 *   Phase 7. PRD 9.5 puts the rating, its histogram and the reviews themselves
 *   on the product page, which is the same anonymous reader as the catalogue
 *   above. A review behind a login is a review nobody reads before deciding to
 *   buy, which is the one moment it exists for. `reviews`, `product_ratings`
 *   and `seller_ratings` are platform-owned with no RLS for exactly this
 *   reader; both routes already filter REMOVED, so moderation binds here too.
 */
const PUBLIC_READS: ReadonlySet<string> = new Set([
  'GET /health',
  'GET /products/:productId/reviews',
  'GET /products/:productId/reviews/summary',
  'GET /cart',
  'GET /auth/google',
  'GET /auth/google/callback',
  'GET /categories',
  'GET /categories/:slug/products',
  'GET /products/:slug',
  'GET /products/:slug/similar',
  'GET /search',
  'GET /search/suggest',
  'GET /serviceability',
  'GET /delivery-slots',
]);

/**
 * PUBLIC ROUTES THAT WRITE, each with the reason it must, and they are kept
 * apart from the reads on purpose.
 *
 * A public read exposes data the database has already decided is public. A
 * public WRITE lets an anonymous caller change server state, which is a
 * different risk class entirely - and an allowlist that mixed the two would let
 * the next one arrive looking like all the entries above it.
 *
 * Phase 4 added the first of these. The test below fails if a public write has
 * no justification, so adding one is a decision somebody wrote down.
 */
const PUBLIC_WRITES: ReadonlyMap<string, string> = new Map([
  [
    'POST /reviews/:id/report',
    'Requiring an account to report abuse means the abuse stays up while the ' +
      'person who noticed it registers, and the people best placed to spot a ' +
      'fake review are shoppers reading the page rather than the one buyer who ' +
      'wrote it. What makes it safe to leave open is that it cannot DESTROY ' +
      'anything: it flags, it does not hide, and it moves only a PUBLISHED ' +
      'review - so no volume of reports can undo a moderator, and the worst a ' +
      'brigade achieves is putting a review in front of a human. The only ' +
      'caller-supplied value reaching a query is an id, which selects one row, ' +
      'and the response says nothing a caller did not already know.',
  ],
  [
    'POST /webhooks/shipping/:provider',
    'A courier holds no NexMarket session; the HMAC over the raw body is the ' +
      'authentication, verified in constant time against a secret that is ' +
      'deliberately NOT the payment one - a leaked courier integration must not ' +
      'let anyone forge a payment. It moves order status but never money, and ' +
      'the only caller-influenced value reaching a query is a tracking number, ' +
      'which selects exactly one parcel. Replays converge rather than ' +
      'duplicating: an event not ahead of where the parcel already is does ' +
      'nothing.',
  ],
  [
    'POST /auth/register',
    'There is no caller identity yet; creating one is the point.',
  ],
  ['POST /auth/login', 'Same: the caller has no token until this succeeds.'],
  [
    'POST /auth/refresh',
    'The caller presents a refresh COOKIE, not a bearer token. Requiring an access token would defeat refreshing after one expires.',
  ],
  [
    'POST /auth/logout',
    'Must work with an EXPIRED access token, or a stale tab can never sign out.',
  ],
  [
    'POST /cart/items',
    'PRD 9.1 requires a guest cart. Requiring sign-in before browsing-to-basket is the single biggest drop-off in a storefront. A guest cart holds listing ids and quantities, carries no money, and cannot place an order - checkout is authenticated.',
  ],
  [
    'PATCH /cart/items/:id',
    'Same guest cart. Scoped to a cart resolved from the caller cookie, so it cannot reach another shopper basket.',
  ],
  [
    'DELETE /cart/items/:id',
    'Same guest cart. Removing a line is scoped to the cart resolved from the caller cookie, so an anonymous caller can only empty their own basket.',
  ],
  [
    'POST /cart/merge',
    'Called on login to fold a guest cart into the member one. It answers 401 without a token; it is public only so the route exists before the guard would refuse the cookie-only case.',
  ],
  [
    'POST /webhooks/payment/:provider',
    'A payment gateway holds no NexMarket session. The HMAC over the raw body IS the authentication, checked in constant time inside the adapter, and a unique constraint on (provider, provider_event_id) makes a replay a no-op.',
  ],
]);

/** Both halves, for the reachability check that does not care which is which. */
const PUBLIC: ReadonlySet<string> = new Set([...PUBLIC_READS, ...PUBLIC_WRITES.keys()]);

/** HEAD and OPTIONS are synthesised by Fastify, not authored here. */
const PROBED_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);

  // Before init(), because Nest registers the routes during it.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        if (PROBED_METHODS.has(method)) registered.push({ method, url: route.url });
      }
    });

  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 90_000);

afterAll(async () => {
  await app?.close();
});

/** `/orgs/:id` cannot be requested literally; a real uuid exercises the same handler. */
function concrete(url: string): string {
  return url.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');
}

function refusedByGuard(res: { statusCode: number; body: string }): boolean {
  if (res.statusCode !== 401) return false;
  try {
    return (JSON.parse(res.body) as { message?: string }).message === AUTH_REQUIRED;
  } catch {
    return false;
  }
}

describe('route coverage', () => {
  it('found routes to check at all', () => {
    // Without this, an enumeration bug turns every assertion below into a loop
    // over an empty array that passes for the wrong reason.
    expect(registered.length).toBeGreaterThanOrEqual(15);
  });

  it('leaves no route both non-public and reachable without a token', async () => {
    const reachable: string[] = [];
    for (const route of registered) {
      const key = `${route.method} ${route.url}`;
      if (PUBLIC.has(key)) continue;
      const res = await app.inject({ method: route.method as 'GET', url: concrete(route.url) });
      // The GUARD's 401 specifically. A route that happens to 401 for its own
      // reasons would otherwise count as protected without being protected.
      if (!refusedByGuard(res)) reachable.push(`${key} -> ${res.statusCode} ${res.body}`);
    }
    expect(reachable).toEqual([]);
  });

  it('justifies every public route that WRITES', () => {
    // Phase 4's audit finding F-5. Before it, the allowlist was 13 reads and
    // one shape; a public mutation would have been indistinguishable from them.
    for (const [route, reason] of PUBLIC_WRITES) {
      expect(reason.length, `${route} needs a written justification`).toBeGreaterThan(40);
    }

    // Nothing that mutates may sit in the reads list, where it would inherit
    // "it is only a read" as its unexamined justification.
    const mutatingReads = [...PUBLIC_READS].filter((route) => !route.startsWith('GET '));
    expect(mutatingReads).toEqual([]);
  });

  it('has no stale entry in the public allowlist', () => {
    // The other direction. An allowlist entry for a route that no longer exists
    // is a licence waiting for a future route to reuse that path.
    const keys = new Set(registered.map((r) => `${r.method} ${r.url}`));
    expect([...PUBLIC].filter((p) => !keys.has(p))).toEqual([]);
  });

  it('serves every public route without a token', async () => {
    // Proves the allowlist describes reality rather than an intention.
    //
    // Not "must not be 401": POST /auth/refresh with no cookie is public and
    // legitimately answers 401 from the handler. What must not happen is the
    // GUARD refusing it, so that is what is checked.
    const refused: string[] = [];
    for (const key of PUBLIC) {
      const [method, url] = key.split(' ') as ['GET', string];
      const res = await app.inject({ method, url });
      if (refusedByGuard(res)) refused.push(key);
    }
    expect(refused).toEqual([]);
  });

  /**
   * Success criterion S6: CI asserts that documented endpoints exist.
   *
   * Built from the same application instance the probes above ran against, so
   * "documented" and "registered" cannot drift - a route added without an
   * @ApiTags controller, or a controller dropped from AppModule, shows up here
   * rather than in someone's browser.
   */
  it('documents every registered route in the OpenAPI document', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('NexMarket API').setVersion('0.1.0').build(),
    );

    const documented = new Set<string>();
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of Object.keys(item)) {
        // OpenAPI paths use {id}; Fastify uses :id.
        documented.add(`${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`);
      }
    }

    const undocumented = registered
      .map((r) => `${r.method} ${r.url}`)
      .filter((key) => !documented.has(key));
    expect(undocumented).toEqual([]);
  });
});