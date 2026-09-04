import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { count, eq } from 'drizzle-orm';
import { schema, withTenant } from '@nexmarket/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';
import { GoogleService } from '../src/modules/auth/google.service.js';

let app: NestFastifyApplication;
let google: GoogleService;

/**
 * Google's endpoints are never contacted. `exchangeCode` is a wire adapter and
 * testing it would test Google; `upsertFromProfile` is the part that decides
 * who gets an account, and that is entirely ours.
 */
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  google = app.get(GoogleService);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

const PASSWORD = 'a-good-password';

function register(email: string): Promise<{ statusCode: number }> {
  return app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: PASSWORD, displayName: 'Test Person' },
  });
}

function profile(overrides: Partial<Parameters<GoogleService['upsertFromProfile']>[0]>) {
  return {
    provider: 'google',
    providerAccountId: 'g-default',
    email: 'someone@example.test',
    emailVerified: true,
    displayName: 'Someone',
    ...overrides,
  };
}

function query<T>(fn: Parameters<typeof withTenant<T>>[1]): Promise<T> {
  return withTenant({ tenantId: null, userId: null, isAdmin: false }, fn);
}

function countIdentitiesFor(userId: string): Promise<number> {
  return query(async (tx) => {
    const rows = await tx
      .select({ n: count() })
      .from(schema.userIdentities)
      .where(eq(schema.userIdentities.userId, userId));
    return rows[0]?.n ?? 0;
  });
}

function countUsersWithEmail(email: string): Promise<number> {
  return query(async (tx) => {
    const rows = await tx
      .select({ n: count() })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return rows[0]?.n ?? 0;
  });
}

function passwordHashFor(userId: string): Promise<string | null> {
  return query(async (tx) => {
    const rows = await tx
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return rows[0]?.passwordHash ?? null;
  });
}

describe('google oauth', () => {
  it('links a Google identity to an existing user by verified email', async () => {
    await register('linkme@example.test');
    const result = await google.upsertFromProfile(
      profile({ providerAccountId: 'g-123', email: 'linkme@example.test', displayName: 'Link Me' }),
    );
    expect(await countIdentitiesFor(result.user.id)).toBe(1);
    expect(await countUsersWithEmail('linkme@example.test')).toBe(1); // linked, not duplicated
  });

  it('refuses to link on an UNVERIFIED google email', async () => {
    // The security-critical one. Auto-linking on an unverified address is full
    // account takeover: anyone who can get a token issued claiming the victim's
    // address inherits their account, password and all.
    await register('victim@example.test');
    await expect(
      google.upsertFromProfile(
        profile({
          providerAccountId: 'g-evil',
          email: 'victim@example.test',
          emailVerified: false,
          displayName: 'Evil',
        }),
      ),
    ).rejects.toThrow();
    expect(await countUsersWithEmail('victim@example.test')).toBe(1);
  });

  it('creates a new passwordless user when the email is unknown', async () => {
    const result = await google.upsertFromProfile(
      profile({
        providerAccountId: 'g-456',
        email: 'brandnew@example.test',
        displayName: 'Brand New',
      }),
    );
    expect(result.user.email).toBe('brandnew@example.test');
    expect(await passwordHashFor(result.user.id)).toBeNull();
  });

  it('is idempotent: a second sign-in reuses the identity rather than adding one', async () => {
    const first = await google.upsertFromProfile(
      profile({ providerAccountId: 'g-repeat', email: 'repeat@example.test' }),
    );
    const second = await google.upsertFromProfile(
      profile({ providerAccountId: 'g-repeat', email: 'repeat@example.test' }),
    );
    expect(second.user.id).toBe(first.user.id);
    expect(await countIdentitiesFor(first.user.id)).toBe(1);
  });

  it('refuses a suspended account rather than letting Google around the status check', async () => {
    await register('suspended@example.test');
    await query(async (tx) => {
      await tx
        .update(schema.users)
        .set({ status: 'SUSPENDED' })
        .where(eq(schema.users.email, 'suspended@example.test'));
    });
    await expect(
      google.upsertFromProfile(
        profile({ providerAccountId: 'g-susp', email: 'suspended@example.test' }),
      ),
    ).rejects.toThrow();
  });

  it('never sets a session cookie on a failed callback', async () => {
    // Deliberately NOT a proof that state is checked: with Google unconfigured
    // the code exchange fails first, so this redirect is identical either way.
    // The state decision itself is covered in google-state.test.ts, where it
    // can actually fail. Mutating the state check away leaves this test green -
    // that is the point of saying so here rather than claiming otherwise.
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback?code=whatever' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toMatch(/error=google/);
    expect(res.cookies).toHaveLength(0);
  });

  it('reports Google as unconfigured rather than failing to boot without credentials', () => {
    // Success criterion S4: a clean clone with no Google credentials must still
    // start and pass the suite. The route exists; it just cannot be used.
    expect(google.configured).toBe(false);
  });
});
