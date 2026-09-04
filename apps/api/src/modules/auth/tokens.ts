import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

/**
 * Issuer and audience, asserted on sign and REQUIRED on verify.
 *
 * Without them a token is only "signed with this secret", so any second token
 * type that ever shares the key - or any sibling service handed the same
 * secret - is accepted here as a NexMarket access token. That is token
 * confusion, and it is cheap to close before there is a second token type to
 * confuse it with. Constants rather than env vars on purpose: these identify
 * the software, not the deployment, and a per-environment value would just be
 * one more thing to get wrong in staging.
 */
export const TOKEN_ISSUER = 'nexmarket-api';
export const TOKEN_AUDIENCE = 'nexmarket-clients';

export type AccessTokenPayload = {
  sub: string;
  email: string;
  platformRole: 'BUYER' | 'ADMIN';
};

/**
 * PRD 13: access tokens are short-lived (15 minutes by default) because they
 * are not revocable. Revocation happens at the refresh boundary, against the
 * sessions table, which is why the access TTL is the real blast radius of a
 * stolen token.
 *
 * Note what is NOT in here: no tenant, no org, no capability list. Membership
 * is read per-request from org_members (plan D-A), so revoking someone's
 * membership takes effect immediately rather than at the next token refresh.
 */
export async function issueAccessToken(
  payload: AccessTokenPayload,
  secret: Uint8Array,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ email: payload.email, platformRole: payload.platformRole })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

/**
 * Returns null on every failure - bad signature, expiry, malformed input.
 *
 * Never throw from here. This runs inside a guard, and distinguishing "expired"
 * from "forged" in the response is an oracle an attacker can probe.
 */
export async function verifyAccessToken(
  token: string,
  secret: Uint8Array,
): Promise<AccessTokenPayload | null> {
  try {
    // jose throws when iss/aud do not match, which the catch turns into null -
    // the same answer as a bad signature, deliberately.
    const { payload } = await jwtVerify(token, secret, {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    if (typeof payload.sub !== 'string' || typeof payload['email'] !== 'string') return null;
    const role = payload['platformRole'];
    // PRD 5.1 / plan D-C: exactly two values. A payload carrying anything else
    // is rejected rather than passed through, so even a leaked signing secret
    // cannot mint a role the platform does not have.
    if (role !== 'BUYER' && role !== 'ADMIN') return null;
    return { sub: payload.sub, email: payload['email'], platformRole: role };
  } catch {
    return null;
  }
}

/**
 * 256 bits from the CSPRNG. Not a JWT: a refresh token carries no claims, it is
 * a lookup key into `sessions`, so there is nothing to encode and nothing to
 * verify offline.
 *
 * SHA-256 rather than argon2id for storage - see plan D-B. These are not
 * user-chosen secrets and cannot be brute-forced, so a slow KDF costs ~100ms
 * per refresh and buys nothing.
 */
export function mintRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
