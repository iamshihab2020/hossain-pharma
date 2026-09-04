import { SignJWT, jwtVerify } from 'jose';

/**
 * The OAuth `state` parameter, as a signed token.
 *
 * Without it the callback accepts any code presented to it, which is login
 * CSRF: an attacker completes half a sign-in with their own Google account,
 * feeds the victim the resulting callback URL, and the victim's browser ends up
 * holding a session belonging to the attacker. Anything the victim then does -
 * saving an address, adding a card - lands in an account the attacker controls.
 *
 * Signed rather than stored because there is nothing worth persisting: the
 * value only has to be unforgeable and short-lived, and a server-side store
 * would need Redis on the login path to prove the same thing.
 */
const STATE_AUDIENCE = 'nexmarket-oauth-state';
const STATE_ISSUER = 'nexmarket-api';
const STATE_TTL_SECONDS = 600;

/**
 * A distinct audience is what keeps this from being an access token.
 *
 * It is signed with the same secret, so without the `aud` check a state token
 * would verify as a login for whatever `sub` it carried. The access-token
 * verifier requires `nexmarket-clients`, this one requires
 * `nexmarket-oauth-state`, and neither accepts the other's tokens.
 */
export async function mintOAuthState(secret: Uint8Array): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(STATE_ISSUER)
    .setAudience(STATE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS)
    .sign(secret);
}

/** False on every failure - forged, expired, wrong audience, or absent. */
export async function verifyOAuthState(
  state: string | undefined,
  secret: Uint8Array,
): Promise<boolean> {
  if (state === undefined || state === '') return false;
  try {
    await jwtVerify(state, secret, { issuer: STATE_ISSUER, audience: STATE_AUDIENCE });
    return true;
  } catch {
    return false;
  }
}
