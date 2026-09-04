import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';

/**
 * PRD 6.4 criteria 1, 3 and 4, at the HTTP layer.
 *
 * Phase 0 proved isolation at the withTenant layer, against a canary table with
 * nothing else attached. This proves it survives the connection pool, the
 * framework, the guard and the interceptor - which is where a transaction-local
 * GUC most plausibly stops being transaction-local.
 *
 * The fixture is the seed (see global-setup): Karim is OWNER in
 * acme-electronics, STAFF in meridian-fashion and OWNER in northwind-home.
 * That is PRD 5.1's headline claim, and it is the only shape that makes these
 * assertions interesting - a user with one role in one org cannot distinguish
 * working isolation from a lucky query.
 */
let app: NestFastifyApplication;

const SEED_PASSWORD = 'nexmarket-demo';

type LoggedIn = { accessToken: string };
type OrgsBody = { items: { id: string; slug: string; roles: string[] }[] };
type MembersBody = { items: { tenantId: string; email: string; role: string }[] };

let acmeId: string;
let meridianId: string;
let northwindId: string;
let karim: LoggedIn;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  karim = await loginAs('karim@acme.test');
  const mine = await get('/orgs/mine', karim);
  const items = mine.json<OrgsBody>().items;
  acmeId = idOf(items, 'acme-electronics');
  meridianId = idOf(items, 'meridian-fashion');
  northwindId = idOf(items, 'northwind-home');
}, 90_000);

afterAll(async () => {
  await app?.close();
});

/**
 * Invitees are registered by this file, never promoted from the seed.
 *
 * Vitest runs test files in parallel against one database, so granting
 * `tanvir@acme.test` a MANAGER role here silently changed what he could do in
 * every other file - and it did: the catalogue suite asserts that a FINANCE
 * user is refused product:write, which passed alone and failed in the suite.
 * Mutating shared fixture data is a coupling no test can see from where it
 * fails.
 */
async function registerInvitee(email: string): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'a-good-password', displayName: 'Invitee' },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
}

async function loginAs(email: string): Promise<LoggedIn> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: SEED_PASSWORD },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
  }
  return { accessToken: res.json<{ accessToken: string }>().accessToken };
}

function get(url: string, who: LoggedIn, tenantId?: string): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'GET',
    url,
    headers: {
      authorization: `Bearer ${who.accessToken}`,
      ...(tenantId === undefined ? {} : { 'x-tenant-id': tenantId }),
    },
  });
}

function idOf(items: OrgsBody['items'], slug: string): string {
  const found = items.find((o) => o.slug === slug);
  if (found === undefined) throw new Error(`seed is missing the org "${slug}"`);
  return found.id;
}

describe('tenancy', () => {
  it('rejects an unauthenticated request to a non-public route (deny by default)', async () => {
    // PRD 13. OrgsController carries no @UseGuards and no @Public(); it is
    // closed because the guard is global. If APP_GUARD registration were ever
    // dropped this returns 200 and the whole phase is undone.
    const res = await app.inject({ method: 'GET', url: '/orgs/mine' });
    expect(res.statusCode).toBe(401);
  });

  it('keeps @Public() routes open', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a forged bearer token as though it were absent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/orgs/mine',
      headers: { authorization: 'Bearer not.a.real.token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lets one user switch context between two orgs (PRD 5.1)', async () => {
    const res = await get('/orgs/mine', karim);
    const items = res.json<OrgsBody>().items;
    expect(items.map((o) => o.slug)).toEqual([
      'acme-electronics',
      'meridian-fashion',
      'northwind-home',
    ]);
    // The roles differ per org, which is the claim the legacy schema could not
    // express: a role on the user row cannot be OWNER here and STAFF there.
    expect(items.find((o) => o.slug === 'acme-electronics')?.roles).toEqual(['OWNER']);
    expect(items.find((o) => o.slug === 'meridian-fashion')?.roles).toEqual(['STAFF']);
  });

  it('scopes a tenant-selected request to that tenant only', async () => {
    const res = await get('/orgs/members', karim, acmeId);
    expect(res.statusCode).toBe(200);
    const items = res.json<MembersBody>().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((m) => m.tenantId === acmeId)).toBe(true);
    // Nadia is a member of BOTH orgs. Seeing her acme row and not her meridian
    // row is the difference between real scoping and a query that happens to
    // return few rows.
    expect(items.some((m) => m.email === 'nadia@acme.test')).toBe(true);
  });

  it('refuses a tenant header for an org the user does not belong to', async () => {
    const rina = await loginAs('rina@buyer.test'); // member of nothing
    const res = await get('/orgs/members', rina, acmeId);
    // 403, not an empty 200. A silent downgrade to "no tenant" would render as
    // an ordinary empty list and hide the authorisation failure entirely.
    expect(res.statusCode).toBe(403);
  });

  it('rejects a malformed tenant header with 400 rather than a 500 from the cast', async () => {
    // set_config takes any string; the policy's NULLIF(...)::uuid then raises
    // inside the query. Without this check a caller typo is a server error.
    const res = await get('/orgs/members', karim, 'not-a-uuid');
    expect(res.statusCode).toBe(400);
  });

  it('enforces capabilities, not role names', async () => {
    const nadia = await loginAs('nadia@acme.test'); // STAFF in acme
    const res = await app.inject({
      method: 'POST',
      url: '/orgs/members',
      headers: { authorization: `Bearer ${nadia.accessToken}`, 'x-tenant-id': acmeId },
      payload: { email: 'rina@buyer.test', role: 'STAFF' },
    });
    expect(res.statusCode).toBe(403); // STAFF lacks member:write
  });

  it('grants the same route to a role that does hold the capability', async () => {
    // The other half of the previous test. Without it, a guard that denied
    // everyone would pass the suite.
    await registerInvitee('tenancy-invitee-a@example.test');
    const res = await app.inject({
      method: 'POST',
      url: '/orgs/members',
      headers: { authorization: `Bearer ${karim.accessToken}`, 'x-tenant-id': acmeId },
      payload: { email: 'tenancy-invitee-a@example.test', role: 'MANAGER' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ tenantId: string }>().tenantId).toBe(acmeId);
  });

  it('refuses a capability-gated route when no organisation is selected', async () => {
    // No x-tenant-id at all. The caller holds member:read somewhere, which is
    // not the same as holding it here, and "somewhere" must never be enough.
    const res = await get('/orgs/members', karim);
    expect(res.statusCode).toBe(403);
  });

  it('withdraws a capability the caller lacks in THIS org while holding it in another', async () => {
    // Karim is OWNER in acme and STAFF in meridian. The same token, the same
    // route, a different tenant header - and the answer has to differ.
    await registerInvitee('tenancy-invitee-b@example.test');
    const allowed = await app.inject({
      method: 'POST',
      url: '/orgs/members',
      headers: { authorization: `Bearer ${karim.accessToken}`, 'x-tenant-id': acmeId },
      payload: { email: 'tenancy-invitee-b@example.test', role: 'STAFF' },
    });
    const denied = await app.inject({
      method: 'POST',
      url: '/orgs/members',
      headers: { authorization: `Bearer ${karim.accessToken}`, 'x-tenant-id': meridianId },
      payload: { email: 'tenancy-invitee-b@example.test', role: 'STAFF' },
    });
    expect(allowed.statusCode).toBe(201);
    expect(denied.statusCode).toBe(403);
  });

  /**
   * PRD 6.4 criterion 3 and success criterion S1.
   *
   * Forty requests alternating between two tenants, all in flight together on a
   * pool of ten connections, so connections are certainly reused mid-run. A
   * session-level SET instead of set_config(..., true) passes every test above
   * this one and fails here - which is the entire reason this test exists.
   *
   * Karim, not the platform admin, because an admin matches
   * platform_admin_bypass and sees every tenant's rows by design: the test
   * would pass while proving nothing. He owns both acme-electronics and
   * northwind-home, so member:read holds in both and the only thing that can
   * differ between the two halves is the isolation itself.
   */
  it('shows zero cross-reads under interleaved two-tenant load', async () => {
    const requests = Array.from({ length: 40 }, (_, i) =>
      get('/orgs/members', karim, i % 2 === 0 ? acmeId : northwindId),
    );
    const results = await Promise.all(requests);

    results.forEach((res, i) => {
      const expected = i % 2 === 0 ? acmeId : northwindId;
      expect(res.statusCode).toBe(200);
      const items = res.json<MembersBody>().items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((m) => m.tenantId === expected)).toBe(true);
    });
  });
});
