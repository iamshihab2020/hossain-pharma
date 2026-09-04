import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';
import { MAX_LIMIT } from '../src/common/pagination.js';
import { effectiveCapabilities } from '../src/common/guards/capability.guard.js';

/**
 * PRD 9.3 seller governance, and the Phase 1 acceptance demo end to end.
 */
let app: NestFastifyApplication;
let admin: Session;

const PASSWORD = 'a-good-password';
const SEED_PASSWORD = 'nexmarket-demo';

type Session = { accessToken: string };
type Org = { id: string; slug: string; status: string };
type Queue = { items: { id: string; status: string; documentCount: number }[]; nextCursor: string | null };

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  admin = await login('admin@nexmarket.test', SEED_PASSWORD);
}, 90_000);

afterAll(async () => {
  await app?.close();
});

async function login(email: string, password: string): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return { accessToken: res.json<{ accessToken: string }>().accessToken };
}

/** Prefixed for the same reason as in onboarding.e2e.test.ts - see the note there. */
async function registerAndLogin(email: string): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: PASSWORD, displayName: 'Applicant' },
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

/** register -> create -> upload -> submit, the seller half of the §11 demo. */
async function applicant(email: string, slug: string): Promise<{ who: Session; org: Org }> {
  const who = await registerAndLogin(email);
  const created = await app.inject({
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
  const org = created.json<Org>();
  await app.inject({
    method: 'POST',
    url: `/orgs/${org.id}/documents`,
    headers: headers(who, org.id),
    payload: {
      type: 'TRADE_LICENCE',
      filename: 'licence.pdf',
      contentType: 'application/pdf',
      contentBase64: Buffer.from('%PDF-1.4').toString('base64'),
    },
  });
  await app.inject({ method: 'POST', url: `/orgs/${org.id}/submit`, headers: headers(who, org.id) });
  return { who, org };
}

function queue(who: Session, query = 'status=PENDING_REVIEW'): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'GET', url: `/admin/orgs?${query}`, headers: headers(who) });
}

function act(who: Session, orgId: string, action: string, reason?: string) {
  return app.inject({
    method: 'POST',
    url: `/admin/orgs/${orgId}/${action}`,
    headers: headers(who),
    ...(reason === undefined ? {} : { payload: { reason } }),
  });
}

function readOrg(who: Session, orgId: string): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'GET', url: `/orgs/${orgId}`, headers: headers(who, orgId) });
}

describe('admin approval queue', () => {
  it('runs the full Phase 1 demo: register -> create org -> submit -> approve -> ACTIVE', async () => {
    const { who, org } = await applicant('admin-demo-seller@example.test', 'novel-goods');

    const pending = await queue(admin);
    expect(pending.statusCode).toBe(200);
    const entry = pending.json<Queue>().items.find((o) => o.id === org.id);
    expect(entry).toBeDefined();
    // The queue carries enough to triage without a second request per row.
    expect(entry?.documentCount).toBe(1);

    expect((await act(admin, org.id, 'approve')).statusCode).toBe(201);
    expect((await readOrg(who, org.id)).json<Org>().status).toBe('ACTIVE');
  });

  it('rejects with a reason and returns the org to DRAFT', async () => {
    const { who, org } = await applicant('admin-rejected@example.test', 'rejected-wares');
    const res = await act(admin, org.id, 'reject', 'Trade licence is illegible');
    expect(res.statusCode).toBe(201);
    expect(res.json<Org>().status).toBe('DRAFT');

    // Back in DRAFT the seller can fix and resubmit - that is what makes
    // PENDING_REVIEW -> DRAFT a transition rather than a dead end.
    const resubmit = await app.inject({
      method: 'POST',
      url: `/orgs/${org.id}/submit`,
      headers: headers(who, org.id),
    });
    expect(resubmit.statusCode).toBe(201);
    expect(resubmit.json<Org>().status).toBe('PENDING_REVIEW');
  });

  it('refuses a rejection with no reason', async () => {
    const { org } = await applicant('admin-noreason@example.test', 'noreason-supply');
    expect((await act(admin, org.id, 'reject')).statusCode).toBe(400);
  });

  it('refuses an illegal transition rather than performing it', async () => {
    // DRAFT -> ACTIVE is not in the table. Approving something never submitted
    // would put a seller live without anyone reading their documents.
    const who = await registerAndLogin('admin-never-submitted@example.test');
    const created = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: headers(who),
      payload: {
        slug: 'never-submitted',
        legalName: 'Never Ltd',
        displayName: 'Never',
        countryCode: 'BD',
        defaultCurrency: 'BDT',
      },
    });
    const org = created.json<Org>();
    const res = await act(admin, org.id, 'approve');
    expect(res.statusCode).toBe(409);
  });

  it('refuses the whole admin surface to a non-admin', async () => {
    const seller = await registerAndLogin('admin-notadmin@example.test');
    expect((await queue(seller)).statusCode).toBe(403);
    expect((await act(seller, crypto.randomUUID(), 'approve')).statusCode).toBe(403);
  });

  it('refuses the admin surface to an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/orgs' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a limit above the maximum rather than honouring it', async () => {
    expect((await queue(admin, `limit=${MAX_LIMIT + 1}`)).statusCode).toBe(400);
    expect((await queue(admin, 'limit=0')).statusCode).toBe(400);
    expect((await queue(admin, 'limit=abc')).statusCode).toBe(400);
  });

  it('rejects a tampered cursor rather than paging from nowhere', async () => {
    expect((await queue(admin, 'cursor=not-a-cursor')).statusCode).toBe(400);
  });

  it('returns nextCursor: null on the last page', async () => {
    const res = await queue(admin, `limit=${MAX_LIMIT}`);
    expect(res.json<Queue>().nextCursor).toBeNull();
  });

  it('returns a stable page when a new row is inserted mid-pagination', async () => {
    // The reason the cursor is (createdAt, id) and not an offset. Read page one,
    // insert a NEWER organisation, then read page two: with an offset the row
    // that was last on page one reappears at the top of page two, because
    // everything shifted down by one.
    // Three applicants of its own, so the test does not depend on what earlier
    // tests happened to leave in the queue. They are the three NEWEST rows, and
    // the queue is newest-first, so they are page one and the top of page two.
    await applicant('admin-page-a@example.test', 'page-a-goods');
    await applicant('admin-page-b@example.test', 'page-b-goods');
    await applicant('admin-page-c@example.test', 'page-c-goods');

    const first = await queue(admin, 'limit=2&status=PENDING_REVIEW');
    const firstIds = first.json<Queue>().items.map((o) => o.id);
    const cursor = first.json<Queue>().nextCursor;
    expect(cursor).not.toBeNull();

    await applicant('admin-interloper@example.test', 'interloper-imports');

    const second = await queue(
      admin,
      `limit=2&status=PENDING_REVIEW&cursor=${encodeURIComponent(cursor as string)}`,
    );
    const secondIds = second.json<Queue>().items.map((o) => o.id);

    expect(secondIds.length).toBeGreaterThan(0);
    // No overlap, and the row inserted after page one was read is not on page
    // two either - it sorts ahead of the cursor, which is the correct answer for
    // a stable read.
    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
  });

  /**
   * PRD 6.6 and the Phase 1 acceptance criterion, verbatim: "Suspended seller
   * can still fulfil open orders."
   *
   * There are no orders until Phase 4, so this asserts the MECHANISM that will
   * carry it rather than the outcome: a suspended org still resolves as a
   * tenant, order capabilities survive, selling capabilities do not. Saying so
   * is better than a test name that claims more than the phase can deliver.
   */
  it('keeps a SUSPENDED seller resolvable, with selling withdrawn and fulfilment intact', async () => {
    const { who, org } = await applicant('admin-suspendme@example.test', 'suspend-me-goods');
    await act(admin, org.id, 'approve');
    const suspended = await act(admin, org.id, 'suspend', 'Repeated late dispatch');
    expect(suspended.statusCode).toBe(201);
    expect(suspended.json<Org>().status).toBe('SUSPENDED');

    // Still a resolvable tenant: the request is served, not 403'd at the door.
    const stillReadable = await readOrg(who, org.id);
    expect(stillReadable.statusCode).toBe(200);

    // settings:write is withdrawn even though OWNER grants it.
    const edit = await app.inject({
      method: 'PATCH',
      url: `/orgs/${org.id}`,
      headers: headers(who, org.id),
      payload: { displayName: 'Renamed While Suspended' },
    });
    expect(edit.statusCode).toBe(403);

    // The effective set is the mechanism Phase 4 will filter orders against.
    const caps = effectiveCapabilities(['OWNER'], 'SUSPENDED');
    expect(caps).toContain('order:write');
    expect(caps).toContain('order:read');
    expect(caps).not.toContain('product:write');
    expect(caps).not.toContain('settings:write');
  });

  it('reinstates a suspended seller', async () => {
    const { who, org } = await applicant('admin-reinstateme@example.test', 'reinstate-me-goods');
    await act(admin, org.id, 'approve');
    await act(admin, org.id, 'suspend', 'Temporary hold');
    expect((await act(admin, org.id, 'reinstate')).statusCode).toBe(201);
    expect((await readOrg(who, org.id)).json<Org>().status).toBe('ACTIVE');
  });
});
