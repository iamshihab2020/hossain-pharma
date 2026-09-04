import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';

let app: NestFastifyApplication;

const PASSWORD = 'a-good-password';
const COOKIE = 'nexmarket_refresh';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

function register(email: string): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: PASSWORD, displayName: 'Test Person' },
  });
}

type AuthBody = { accessToken: string; user: { email: string } };
type ErrorBody = { message: string };

/** res.json() is untyped; naming the shape once keeps the assertions type-safe. */
function body<T>(res: LightMyRequestResponse): T {
  return res.json<T>();
}

function extractRefresh(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === COOKIE);
  if (cookie === undefined) throw new Error('no refresh cookie on the response');
  return cookie.value;
}

function refreshWith(token: string): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/auth/refresh',
    cookies: { [COOKIE]: token },
  });
}

async function registerAndGetRefresh(email: string): Promise<string> {
  return extractRefresh(await register(email));
}

describe('auth', () => {
  it('registers a user and sets an httpOnly refresh cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'New@Example.test', password: PASSWORD, displayName: 'New' },
    });
    expect(res.statusCode).toBe(201);
    expect(body<AuthBody>(res).user.email).toBe('new@example.test'); // lower-cased
    // PRD 13: no token in JS. The refresh token exists only as a cookie.
    expect(res.json()).not.toHaveProperty('refreshToken');
    const cookie = res.cookies.find((c) => c.name === COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    expect(cookie?.path).toBe('/auth');
  });

  it('rejects a password shorter than the policy', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'short@example.test', password: 'short', displayName: 'Short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a duplicate email without revealing which field collided', async () => {
    await register('dupe@example.test');
    const res = await register('dupe@example.test');
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.json())).not.toMatch(/email/i);
  });

  it('logs in and returns an access token', async () => {
    await register('login@example.test');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'login@example.test', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof body<AuthBody>(res).accessToken).toBe('string');
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    // Account enumeration: if these differ, an attacker learns which addresses
    // are registered without ever guessing a password.
    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@example.test', password: 'whatever-long-enough' },
    });
    await register('known@example.test');
    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'known@example.test', password: 'wrong-password-here' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(body<ErrorBody>(unknown).message).toBe(body<ErrorBody>(wrong).message);
  });

  it('rotates the refresh token, invalidating the old one', async () => {
    const first = await registerAndGetRefresh('rotate@example.test');
    const second = await refreshWith(first);
    expect(second.statusCode).toBe(200);
    expect(extractRefresh(second)).not.toBe(first);
    const replay = await refreshWith(first);
    expect(replay.statusCode).toBe(401);
  });

  it('revokes the whole family when a superseded token is replayed', async () => {
    // The requirement that matters. Rotation alone is easy; reuse detection
    // killing the family is what turns a stolen token into a detected incident
    // rather than a silent parallel session.
    const first = await registerAndGetRefresh('reuse@example.test');
    const secondToken = extractRefresh(await refreshWith(first));
    await refreshWith(first); // the replay - detected here
    const after = await refreshWith(secondToken); // the good token must now be dead too
    expect(after.statusCode).toBe(401);
  });

  it('logs out, killing the family, and is silent about unknown tokens', async () => {
    const token = await registerAndGetRefresh('logout@example.test');
    const out = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { [COOKIE]: token },
    });
    expect(out.statusCode).toBe(204);
    expect((await refreshWith(token)).statusCode).toBe(401);

    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { [COOKIE]: 'a'.repeat(64) },
    });
    expect(unknown.statusCode).toBe(204);
  });

  it('rejects a refresh with no cookie at all', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/refresh' });
    expect(res.statusCode).toBe(401);
  });
});
