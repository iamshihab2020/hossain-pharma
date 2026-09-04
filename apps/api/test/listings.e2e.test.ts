import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';

/**
 * PRD 9.2 catalogue management, and the second Phase 2 acceptance criterion:
 * "RLS blocks seller A from editing seller B's listing."
 */
let app: NestFastifyApplication;

const SEED_PASSWORD = 'nexmarket-demo';

type Session = { accessToken: string; tenantId: string };
type Listing = {
  id: string;
  sku: string;
  status: string;
  availableStock: number;
  price: { amount: number; currency: string };
  shippingAmount: number;
};

let karimAcme: Session;
let karimNorthwind: Session;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  // Karim OWNS both acme-electronics and northwind-home. Two sessions for one
  // human, differing only in the tenant header, is the cleanest way to prove
  // the isolation is the TENANT's and not the user's.
  karimAcme = await sessionFor('karim@acme.test', 'acme-electronics');
  karimNorthwind = await sessionFor('karim@acme.test', 'northwind-home');
}, 90_000);

afterAll(async () => {
  await app?.close();
});

async function sessionFor(email: string, orgSlug: string): Promise<Session> {
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: SEED_PASSWORD },
  });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.statusCode} ${login.body}`);
  const accessToken = login.json<{ accessToken: string }>().accessToken;

  const orgs = await app.inject({
    method: 'GET',
    url: '/orgs/mine',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const org = orgs.json<{ items: { id: string; slug: string }[] }>().items.find((o) => o.slug === orgSlug);
  if (org === undefined) throw new Error(`${email} is not a member of ${orgSlug}`);
  return { accessToken, tenantId: org.id };
}

function headers(who: Session): Record<string, string> {
  return { authorization: `Bearer ${who.accessToken}`, 'x-tenant-id': who.tenantId };
}

function req(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  who: Session,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  const base = { method, url, headers: headers(who) };
  return payload === undefined ? app.inject(base) : app.inject({ ...base, payload });
}

/**
 * A listing this suite can rely on, chosen BY SKU rather than by "whichever is
 * newest".
 *
 * Test files run in parallel against one database and other suites publish
 * listings for the same sellers, so "items[0]" is whatever another file
 * happened to create a moment ago. Naming the SKU makes the fixture this
 * suite's own.
 */
async function listingFor(who: Session, sku: string): Promise<Listing> {
  const res = await req('GET', '/listings?limit=100', who);
  const listing = res.json<{ items: Listing[] }>().items.find((l) => l.sku === sku);
  if (listing === undefined) throw new Error(`no listing on ${sku} for that tenant`);
  return listing;
}

const ACME_SKU = 'AUR-X1-128-VIO';
const NORTHWIND_SKU = 'AUR-X1-128-VIO';

async function variantId(sku: string, productSlug = 'aurora-x1'): Promise<string> {
  const product = await app.inject({ method: 'GET', url: `/products/${productSlug}` });
  const variant = product
    .json<{ variants: { id: string; sku: string }[] }>()
    .variants.find((v) => v.sku === sku);
  if (variant === undefined) throw new Error(`no variant ${sku}`);
  return variant.id;
}

describe('seller listing management', () => {
  it('scopes the listing list to the active tenant', async () => {
    const acme = await req('GET', '/listings', karimAcme);
    const northwind = await req('GET', '/listings', karimNorthwind);
    expect(acme.statusCode).toBe(200);

    const acmeIds = acme.json<{ items: Listing[] }>().items.map((l) => l.id);
    const northwindIds = northwind.json<{ items: Listing[] }>().items.map((l) => l.id);
    expect(acmeIds.length).toBeGreaterThan(0);
    expect(northwindIds.length).toBeGreaterThan(0);
    // The same token, a different header, and no overlap at all.
    expect(acmeIds.filter((id) => northwindIds.includes(id))).toEqual([]);
  });

  /**
   * THE PRD 11 PHASE 2 ACCEPTANCE CRITERION:
   * "RLS blocks seller A from editing seller B's listing."
   */
  it('blocks one seller from editing another sellers listing', async () => {
    const theirs = await listingFor(karimNorthwind, NORTHWIND_SKU);
    const before = theirs.price.amount;

    // Reading it as acme: not 403, but 404 - under RLS the row is simply not
    // there, and a 403 would confirm that the id is real.
    expect((await req('GET', `/listings/${theirs.id}`, karimAcme)).statusCode).toBe(404);

    const edit = await req('PATCH', `/listings/${theirs.id}`, karimAcme, { priceAmount: 1 });
    expect(edit.statusCode).toBe(404);

    // And the row is untouched. Without this the test would pass against a
    // service that returned 404 AFTER writing.
    const after = await req('GET', `/listings/${theirs.id}`, karimNorthwind);
    expect(after.json<Listing>().price.amount).toBe(before);
  });

  it('creates a DRAFT listing, stocks it, and publishes it', async () => {
    const variant = await variantId('AUR-X1-256-BLK');

    const created = await req('POST', '/listings', karimNorthwind, {
      variantId: variant,
      priceAmount: 4_400_000,
      priceCurrency: 'BDT',
      shippingAmount: 5_000,
      dispatchDays: 2,
    });
    expect(created.statusCode).toBe(201);
    const listing = created.json<Listing>();
    expect(listing.status).toBe('DRAFT');
    expect(listing.availableStock).toBe(0);

    // Publishing with no stock produces an offer the buy box would drop, so it
    // is refused rather than silently invisible.
    const early = await req('POST', `/listings/${listing.id}/publish`, karimNorthwind);
    expect(early.statusCode).toBe(409);

    const warehouses = await req('GET', '/warehouses', karimNorthwind);
    const warehouseId = warehouses.json<{ items: { id: string }[] }>().items[0]?.id;

    const stocked = await req('PUT', `/listings/${listing.id}/inventory`, karimNorthwind, {
      warehouseId,
      onHand: 7,
    });
    expect(stocked.statusCode).toBe(200);
    expect(stocked.json<Listing>().availableStock).toBe(7);

    const published = await req('POST', `/listings/${listing.id}/publish`, karimNorthwind);
    expect(published.statusCode).toBe(201);
    expect(published.json<Listing>().status).toBe('ACTIVE');

    // And it is now on the public page, with no login involved.
    const page = await app.inject({ method: 'GET', url: '/products/aurora-x1' });
    const offers = page
      .json<{ variants: { sku: string; buyBox: { offers: { seller: { slug: string } }[] } }[] }>()
      .variants.find((v) => v.sku === 'AUR-X1-256-BLK')?.buyBox.offers;
    expect(offers?.map((o) => o.seller.slug)).toContain('northwind-home');
  });

  it('is idempotent when stock is set twice - PUT, not a delta', async () => {
    // A delta API has no idempotency: a retry after a timeout doubles the
    // adjustment. "Set it to 7" survives being sent twice.
    const listing = await listingFor(karimAcme, ACME_SKU);
    const warehouses = await req('GET', '/warehouses', karimAcme);
    const warehouseId = warehouses.json<{ items: { id: string }[] }>().items[0]?.id;

    const once = await req('PUT', `/listings/${listing.id}/inventory`, karimAcme, {
      warehouseId,
      onHand: 9,
    });
    const twice = await req('PUT', `/listings/${listing.id}/inventory`, karimAcme, {
      warehouseId,
      onHand: 9,
    });
    expect(once.json<Listing>().availableStock).toBe(9);
    expect(twice.json<Listing>().availableStock).toBe(9);
  });

  it('refuses a second offer from the same seller on the same variant', async () => {
    const listing = await listingFor(karimAcme, ACME_SKU);
    const full = await req('GET', `/listings/${listing.id}`, karimAcme);
    const variant = full.json<{ variantId: string }>().variantId;

    const duplicate = await req('POST', '/listings', karimAcme, {
      variantId: variant,
      priceAmount: 1_000_000,
      priceCurrency: 'BDT',
    });
    // Otherwise a seller competes with themselves in their own buy box.
    expect(duplicate.statusCode).toBe(409);
  });

  it('refuses a price that is not an integer number of minor units', async () => {
    // The legacy server did parseInt(price * 100) and truncated. A decimal here
    // means the caller has misunderstood the unit, and rounding it would store
    // a number that is quietly wrong.
    const variant = await variantId('AUR-X1-128-VIO');
    const res = await req('POST', '/listings', karimNorthwind, {
      variantId: variant,
      priceAmount: 38500.75,
      priceCurrency: 'BDT',
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a sale price above the base price', async () => {
    const listing = await listingFor(karimAcme, ACME_SKU);
    const res = await req('PATCH', `/listings/${listing.id}`, karimAcme, {
      salePriceAmount: listing.price.amount + 1,
    });
    // 400, not 500. The CHECK in migration 0008 is where the rule lives, but a
    // constraint the CALLER violated is a caller error, and reporting it as a
    // server error says the server broke doing exactly what it was built to do.
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/listings_prices_non_negative/);
  });

  it('pauses and resumes an offer, removing it from the public page in between', async () => {
    const listing = await listingFor(karimAcme, ACME_SKU);

    expect((await req('POST', `/listings/${listing.id}/pause`, karimAcme)).statusCode).toBe(201);
    const paused = await app.inject({ method: 'GET', url: '/products/aurora-x1' });
    const pausedOffers = paused
      .json<{ variants: { buyBox: { offers: { listingId: string }[] } }[] }>()
      .variants.flatMap((v) => v.buyBox.offers.map((o) => o.listingId));
    expect(pausedOffers).not.toContain(listing.id);

    expect((await req('POST', `/listings/${listing.id}/resume`, karimAcme)).statusCode).toBe(201);
    const resumed = await app.inject({ method: 'GET', url: '/products/aurora-x1' });
    const resumedOffers = resumed
      .json<{ variants: { buyBox: { offers: { listingId: string }[] } }[] }>()
      .variants.flatMap((v) => v.buyBox.offers.map((o) => o.listingId));
    expect(resumedOffers).toContain(listing.id);
  });

  it('refuses to edit an archived listing', async () => {
    // The tote belongs to meridian-fashion's product, which acme does not yet
    // offer - so acme can create a fresh DRAFT on it without colliding with the
    // seed or with an earlier test.
    const draft = await req('POST', '/listings', karimAcme, {
      variantId: await variantId('MER-TOTE-OS', 'meridian-canvas-tote'),
      priceAmount: 150_000,
      priceCurrency: 'BDT',
    });
    expect(draft.statusCode).toBe(201);
    const id = draft.json<Listing>().id;

    expect((await req('POST', `/listings/${id}/archive`, karimAcme)).statusCode).toBe(201);
    const edit = await req('PATCH', `/listings/${id}`, karimAcme, { priceAmount: 1_000 });
    expect(edit.statusCode).toBe(409);
    // ARCHIVED is terminal, so there is no way back either.
    expect((await req('POST', `/listings/${id}/resume`, karimAcme)).statusCode).toBe(409);
  });

  it('refuses listing management to a role without product:write', async () => {
    // nadia is STAFF in acme. PRD 5.3 gives STAFF product:read and no write.
    const nadia = await sessionFor('nadia@acme.test', 'acme-electronics');
    expect((await req('GET', '/listings', nadia)).statusCode).toBe(200);
    const res = await req('POST', '/listings', nadia, {
      variantId: await variantId('AUR-X1-128-VIO'),
      priceAmount: 1,
      priceCurrency: 'BDT',
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses stock against another tenants warehouse', async () => {
    const acmeListing = await listingFor(karimAcme, ACME_SKU);
    const theirWarehouses = await req('GET', '/warehouses', karimNorthwind);
    const theirWarehouseId = theirWarehouses.json<{ items: { id: string }[] }>().items[0]?.id;

    const res = await req('PUT', `/listings/${acmeListing.id}/inventory`, karimAcme, {
      warehouseId: theirWarehouseId,
      onHand: 1,
    });
    // Under RLS the other tenant's warehouse is invisible, so this is a 400
    // "no such warehouse" - the same answer as a typo, which is correct.
    expect(res.statusCode).toBe(400);
  });
});

describe('restricted categories route through review', () => {
  it('sends a listing in a RESTRICTED category to PENDING_REVIEW, not ACTIVE', async () => {
    const product = await app.inject({ method: 'GET', url: '/products/harbour-single-malt' });
    const variant = product.json<{ variants: { id: string }[] }>().variants[0]?.id;

    const created = await req('POST', '/listings', karimAcme, {
      variantId: variant,
      priceAmount: 850_000,
      priceCurrency: 'BDT',
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<Listing>().id;

    const warehouses = await req('GET', '/warehouses', karimAcme);
    await req('PUT', `/listings/${id}/inventory`, karimAcme, {
      warehouseId: warehouses.json<{ items: { id: string }[] }>().items[0]?.id,
      onHand: 4,
    });

    const published = await req('POST', `/listings/${id}/publish`, karimAcme);
    expect(published.statusCode).toBe(201);
    // Not ACTIVE. This is what gives the RESTRICTED flag a job in the phase
    // that introduces it, rather than waiting for the Phase 4 age gate.
    expect(published.json<Listing>().status).toBe('PENDING_REVIEW');

    // And it is NOT on the public page while it waits.
    const page = await app.inject({ method: 'GET', url: '/products/harbour-single-malt' });
    expect(page.json<{ variants: { buyBox: { offers: unknown[] } }[] }>().variants[0]?.buyBox.offers).toEqual(
      [],
    );

    const admin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@nexmarket.test', password: SEED_PASSWORD },
    });
    const adminToken = admin.json<{ accessToken: string }>().accessToken;

    const queue = await app.inject({
      method: 'GET',
      url: '/admin/listings',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(queue.json<{ items: { id: string }[] }>().items.map((l) => l.id)).toContain(id);

    const approved = await app.inject({
      method: 'POST',
      url: `/admin/listings/${id}/approve`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(approved.statusCode).toBe(201);

    const live = await app.inject({ method: 'GET', url: '/products/harbour-single-malt' });
    expect(
      live.json<{ variants: { buyBox: { winner: { listingId: string } | null } }[] }>().variants[0]
        ?.buyBox.winner?.listingId,
    ).toBe(id);
  });

  it('refuses to approve a listing that is not awaiting review', async () => {
    const listing = await listingFor(karimAcme, ACME_SKU);

    const admin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@nexmarket.test', password: SEED_PASSWORD },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/listings/${listing.id}/approve`,
      headers: { authorization: `Bearer ${admin.json<{ accessToken: string }>().accessToken}` },
    });
    // Approving an ACTIVE listing is a no-op that looks like a decision.
    expect(res.statusCode).toBe(409);
  });
});
