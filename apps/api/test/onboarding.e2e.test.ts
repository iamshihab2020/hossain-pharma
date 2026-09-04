import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';

/**
 * PRD 9.2 seller onboarding, and the PRD 6.6 state machine it drives.
 *
 * The states are the thing worth protecting. An illegal transition has to be
 * refused by the service rather than merely absent from a UI, because the UI is
 * not what an integrator or a Phase 4 job will be calling.
 */
let app: NestFastifyApplication;

const PASSWORD = 'a-good-password';

type Session = { accessToken: string };
type OrgBody = { id: string; slug: string; status: string; displayName: string };
type DocsBody = { items: { id: string; type: string; tenantId: string }[] };

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 90_000);

afterAll(async () => {
  await app?.close();
});

/**
 * Every address here carries an `onboarding-` prefix.
 *
 * Vitest runs test FILES in parallel against the one database this suite spins
 * up, and `users.email` is globally unique - so a bare `dupe@example.test` in
 * two files is a 409 in whichever loses the race, intermittently and only in a
 * full run. It cost a green single-file run and a red suite to find once.
 */
async function registerAndLogin(email: string): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: PASSWORD, displayName: 'Seller Person' },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  return { accessToken: res.json<{ accessToken: string }>().accessToken };
}

function headers(who: Session, tenantId?: string): Record<string, string> {
  return {
    authorization: `Bearer ${who.accessToken}`,
    ...(tenantId === undefined ? {} : { 'x-tenant-id': tenantId }),
  };
}

async function createOrg(who: Session, slug: string): Promise<OrgBody> {
  const res = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: headers(who),
    payload: {
      slug,
      legalName: `${slug} Limited`,
      displayName: slug,
      countryCode: 'BD',
      defaultCurrency: 'BDT',
    },
  });
  if (res.statusCode !== 201) throw new Error(`createOrg failed: ${res.statusCode} ${res.body}`);
  return res.json<OrgBody>();
}

function uploadDocument(who: Session, orgId: string, type: string): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/documents`,
    headers: headers(who, orgId),
    payload: {
      type,
      filename: 'licence.pdf',
      contentType: 'application/pdf',
      contentBase64: Buffer.from('%PDF-1.4 pretend document').toString('base64'),
    },
  });
}

function submit(who: Session, orgId: string): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/submit`,
    headers: headers(who, orgId),
  });
}

describe('seller onboarding', () => {
  it('creates an org in DRAFT and makes the creator its OWNER', async () => {
    const seller = await registerAndLogin('onboarding-founder@example.test');
    const org = await createOrg(seller, 'founder-goods');
    expect(org.status).toBe('DRAFT');

    // OWNER, proved by exercising an OWNER-only capability rather than by
    // reading the role back - the role is only interesting if it grants
    // something, and member:read is the cheapest thing it grants.
    const members = await app.inject({
      method: 'GET',
      url: '/orgs/members',
      headers: headers(seller, org.id),
    });
    expect(members.statusCode).toBe(200);
    expect(members.json<{ items: { role: string }[] }>().items).toEqual([
      expect.objectContaining({ role: 'OWNER', email: 'onboarding-founder@example.test' }),
    ]);
  });

  it('refuses a duplicate slug', async () => {
    const seller = await registerAndLogin('onboarding-dupe@example.test');
    await createOrg(seller, 'taken-slug');
    const second = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: headers(seller),
      payload: {
        slug: 'taken-slug',
        legalName: 'Another Ltd',
        displayName: 'Another',
        countryCode: 'BD',
        defaultCurrency: 'BDT',
      },
    });
    expect(second.statusCode).toBe(409);
  });

  it('refuses to submit an org with no documents', async () => {
    const seller = await registerAndLogin('onboarding-nodocs@example.test');
    const org = await createOrg(seller, 'nodocs-trading');
    const res = await submit(seller, org.id);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ message: string }>().message).toMatch(/document/i);
  });

  it('moves DRAFT -> PENDING_REVIEW on submit', async () => {
    const seller = await registerAndLogin('onboarding-submitter@example.test');
    const org = await createOrg(seller, 'submitter-supplies');
    expect((await uploadDocument(seller, org.id, 'TRADE_LICENCE')).statusCode).toBe(201);
    const res = await submit(seller, org.id);
    expect(res.statusCode).toBe(201);
    expect(res.json<OrgBody>().status).toBe('PENDING_REVIEW');
  });

  it('refuses to submit an org already in PENDING_REVIEW', async () => {
    const seller = await registerAndLogin('onboarding-twice@example.test');
    const org = await createOrg(seller, 'twice-traders');
    await uploadDocument(seller, org.id, 'TRADE_LICENCE');
    await submit(seller, org.id);
    const again = await submit(seller, org.id);
    expect(again.statusCode).toBe(409);
  });

  it('refuses to edit business details while the org is under review', async () => {
    // The admin approving a set of details has to be approving the ones they
    // read. This is the state machine protecting the reviewer, not the seller.
    const seller = await registerAndLogin('onboarding-editor@example.test');
    const org = await createOrg(seller, 'editor-emporium');
    await uploadDocument(seller, org.id, 'TRADE_LICENCE');

    const beforeSubmit = await app.inject({
      method: 'PATCH',
      url: `/orgs/${org.id}`,
      headers: headers(seller, org.id),
      payload: { displayName: 'Edited Before' },
    });
    expect(beforeSubmit.statusCode).toBe(200);

    await submit(seller, org.id);
    const afterSubmit = await app.inject({
      method: 'PATCH',
      url: `/orgs/${org.id}`,
      headers: headers(seller, org.id),
      payload: { displayName: 'Edited After' },
    });
    expect(afterSubmit.statusCode).toBe(409);
  });

  it('refuses to let a member of another org read these documents', async () => {
    const mine = await registerAndLogin('onboarding-mine@example.test');
    const theirs = await registerAndLogin('onboarding-theirs@example.test');
    const myOrg = await createOrg(mine, 'my-private-org');
    const theirOrg = await createOrg(theirs, 'their-private-org');
    await uploadDocument(mine, myOrg.id, 'NATIONAL_ID');

    // Their own org, their own header - and my documents are simply not there.
    const scoped = await app.inject({
      method: 'GET',
      url: `/orgs/${theirOrg.id}/documents`,
      headers: headers(theirs, theirOrg.id),
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json<DocsBody>().items).toHaveLength(0);

    // My org id in the path, their header: the path and the active tenant
    // disagree, which is a 403 rather than a read of my row.
    const crossed = await app.inject({
      method: 'GET',
      url: `/orgs/${myOrg.id}/documents`,
      headers: headers(theirs, theirOrg.id),
    });
    expect(crossed.statusCode).toBe(403);

    // My org id in BOTH, from their token: the interceptor never gets past
    // membership, so this is the same 403 for a different reason. Both paths
    // are tested because closing one and leaving the other is the mistake.
    const impersonated = await app.inject({
      method: 'GET',
      url: `/orgs/${myOrg.id}/documents`,
      headers: headers(theirs, myOrg.id),
    });
    expect(impersonated.statusCode).toBe(403);
  });

  it('stores the document under a key that contains no part of the filename', async () => {
    // A caller-supplied filename in a filesystem path is a traversal bug. The
    // name survives as data in original_filename; it never reaches the path.
    const seller = await registerAndLogin('onboarding-traversal@example.test');
    const org = await createOrg(seller, 'traversal-trading');
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${org.id}/documents`,
      headers: headers(seller, org.id),
      payload: {
        type: 'BANK_PROOF',
        filename: '../../../etc/passwd',
        contentType: 'image/png',
        contentBase64: Buffer.from('not really a png').toString('base64'),
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ originalFilename: string }>().originalFilename).toBe('../../../etc/passwd');
    // storageKey is not on the wire at all - a client that cannot see it cannot
    // build a URL out of it.
    expect(res.json<Record<string, unknown>>()['storageKey']).toBeUndefined();
  });

  it('rejects a body that is not valid base64 rather than storing an empty file', async () => {
    const seller = await registerAndLogin('onboarding-badbase64@example.test');
    const org = await createOrg(seller, 'badbase64-books');
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${org.id}/documents`,
      headers: headers(seller, org.id),
      payload: {
        type: 'TRADE_LICENCE',
        filename: 'x.pdf',
        contentType: 'application/pdf',
        // Buffer.from(..., 'base64') silently drops what it cannot decode, so
        // without an explicit check this stores a zero-byte document and 201s.
        contentBase64: '!!!!',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses an unknown country code instead of failing on the foreign key', async () => {
    const seller = await registerAndLogin('onboarding-badcountry@example.test');
    const res = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: headers(seller),
      payload: {
        slug: 'badcountry-goods',
        legalName: 'Nowhere Ltd',
        displayName: 'Nowhere',
        countryCode: 'ZZ',
        defaultCurrency: 'BDT',
      },
    });
    // Not a 500. The reference tables are foreign keys, and an unknown value is
    // a caller error whichever layer notices it first.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});
