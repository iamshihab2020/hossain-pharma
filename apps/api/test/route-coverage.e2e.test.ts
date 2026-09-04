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
 */
const PUBLIC: ReadonlySet<string> = new Set([
  'GET /health',
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/logout',
  'GET /auth/google',
  'GET /auth/google/callback',
  'GET /categories',
  'GET /categories/:slug/products',
  'GET /products/:slug',
  'GET /products/:slug/similar',
  'GET /search',
  'GET /search/suggest',
]);

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