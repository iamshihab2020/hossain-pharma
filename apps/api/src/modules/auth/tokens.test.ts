import { describe, expect, it } from 'vitest';
import {
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  hashRefreshToken,
  issueAccessToken,
  mintRefreshToken,
  verifyAccessToken,
} from './tokens.js';

/** A correctly-signed token with arbitrary claims, for the forgery tests. */
async function forge(
  claims: Record<string, unknown>,
  opts: { issuer?: string; audience?: string } = {},
): Promise<string> {
  const { SignJWT } = await import('jose');
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('u1')
    .setIssuer(opts.issuer ?? TOKEN_ISSUER)
    .setAudience(opts.audience ?? TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
    .sign(secret);
}

const secret = new TextEncoder().encode('a'.repeat(32));

describe('tokens', () => {
  it('round-trips an access token', async () => {
    const token = await issueAccessToken(
      { sub: 'u1', email: 'a@b.test', platformRole: 'BUYER' },
      secret,
      900,
    );
    expect(await verifyAccessToken(token, secret)).toMatchObject({ sub: 'u1', email: 'a@b.test' });
  });

  it('returns null for a token signed with a different secret', async () => {
    const token = await issueAccessToken(
      { sub: 'u1', email: 'a@b.test', platformRole: 'BUYER' },
      secret,
      900,
    );
    const other = new TextEncoder().encode('b'.repeat(32));
    expect(await verifyAccessToken(token, other)).toBeNull();
  });

  it('returns null for an expired token rather than throwing', async () => {
    const token = await issueAccessToken(
      { sub: 'u1', email: 'a@b.test', platformRole: 'BUYER' },
      secret,
      -1,
    );
    expect(await verifyAccessToken(token, secret)).toBeNull();
  });

  it('returns null for garbage', async () => {
    // Never throw from the verify path: distinguishing "expired" from "forged"
    // in the response is an oracle an attacker can probe.
    expect(await verifyAccessToken('not.a.token', secret)).toBeNull();
  });

  it('rejects a token whose platformRole is not one of the two values', async () => {
    // A forged-but-correctly-signed payload should still fail the shape check,
    // so a leaked secret cannot mint a role the enum does not have.
    // Issuer and audience are correct here on purpose, so this test fails on
    // the role and nothing else.
    const token = await forge({ email: 'a@b.test', platformRole: 'SELLER' });
    expect(await verifyAccessToken(token, secret)).toBeNull();
  });

  it('rejects a token from another issuer signed with the same secret', async () => {
    // Token confusion: a sibling service handed the same signing key must not
    // be able to mint something this API accepts as a login.
    const token = await forge(
      { email: 'a@b.test', platformRole: 'BUYER' },
      { issuer: 'some-other-service' },
    );
    expect(await verifyAccessToken(token, secret)).toBeNull();
  });

  it('rejects a token minted for a different audience', async () => {
    const token = await forge(
      { email: 'a@b.test', platformRole: 'BUYER' },
      { audience: 'nexmarket-internal' },
    );
    expect(await verifyAccessToken(token, secret)).toBeNull();
  });

  it('mints refresh tokens with 256 bits of entropy and a stable hash', () => {
    const a = mintRefreshToken();
    const b = mintRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toHaveLength(64);
    expect(a.hash).toBe(hashRefreshToken(a.token));
    expect(a.hash).not.toBe(a.token);
  });
});
