import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { mintOAuthState, verifyOAuthState } from './google-state.js';
import { TOKEN_AUDIENCE, TOKEN_ISSUER } from './tokens.js';

const secret = new TextEncoder().encode('a'.repeat(32));
const other = new TextEncoder().encode('b'.repeat(32));

describe('oauth state', () => {
  it('round-trips a freshly minted state', async () => {
    expect(await verifyOAuthState(await mintOAuthState(secret), secret)).toBe(true);
  });

  it('rejects a state signed with a different secret', async () => {
    expect(await verifyOAuthState(await mintOAuthState(other), secret)).toBe(false);
  });

  it('rejects a missing or empty state', async () => {
    // The callback with no state at all is the plain login-CSRF attempt.
    expect(await verifyOAuthState(undefined, secret)).toBe(false);
    expect(await verifyOAuthState('', secret)).toBe(false);
  });

  it('rejects garbage', async () => {
    expect(await verifyOAuthState('not.a.token', secret)).toBe(false);
  });

  it('rejects an expired state', async () => {
    const stale = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('nexmarket-api')
      .setAudience('nexmarket-oauth-state')
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(secret);
    expect(await verifyOAuthState(stale, secret)).toBe(false);
  });

  it('does NOT accept an access token as state', async () => {
    // Both are HS256 under the same secret, so the audience is the only thing
    // separating them. Without that check a state token would verify as a login
    // for whatever subject it carried, and vice versa.
    const accessShaped = await new SignJWT({ email: 'a@b.test', platformRole: 'BUYER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
      .sign(secret);
    expect(await verifyOAuthState(accessShaped, secret)).toBe(false);
  });

  it('does NOT accept a state token as an access token', async () => {
    const { verifyAccessToken } = await import('./tokens.js');
    expect(await verifyAccessToken(await mintOAuthState(secret), secret)).toBeNull();
  });
});
