import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { schema, withTenant, type Transaction } from '@nexmarket/db';
import { loadApiEnv, type ApiEnv } from '../../config/env.js';

export const GOOGLE_PROVIDER = 'google';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * What we need from Google, and nothing else. `emailVerified` is not optional
 * and not a convenience: see the guard in `upsertFromProfile`.
 */
export type GoogleProfile = {
  provider: string;
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
};

export type LinkedUser = {
  user: {
    id: string;
    email: string;
    displayName: string;
  };
};

type UserRow = LinkedUser['user'] & { status: string };

@Injectable()
export class GoogleService {
  private readonly env: ApiEnv = loadApiEnv();

  /**
   * Cached across requests: it fetches Google's signing keys over the network,
   * and a new set per login would put an outbound HTTP call on every callback.
   * jose handles the refresh and the cache headers itself.
   */
  private readonly jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));

  /**
   * Google is optional. A clone with no credentials must still boot and pass
   * the suite (success criterion S4), so the routes answer 503 rather than the
   * application refusing to start.
   */
  get configured(): boolean {
    return (
      this.env.GOOGLE_CLIENT_ID !== undefined &&
      this.env.GOOGLE_CLIENT_SECRET !== undefined &&
      this.env.GOOGLE_CALLBACK_URL !== undefined
    );
  }

  private requireConfig(): { clientId: string; clientSecret: string; callbackUrl: string } {
    if (
      this.env.GOOGLE_CLIENT_ID === undefined ||
      this.env.GOOGLE_CLIENT_SECRET === undefined ||
      this.env.GOOGLE_CALLBACK_URL === undefined
    ) {
      throw new ServiceUnavailableException('Google sign-in is not configured');
    }
    return {
      clientId: this.env.GOOGLE_CLIENT_ID,
      clientSecret: this.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: this.env.GOOGLE_CALLBACK_URL,
    };
  }

  buildAuthUrl(state: string): string {
    const config = this.requireConfig();
    const url = new URL(GOOGLE_AUTH_ENDPOINT);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.callbackUrl);
    url.searchParams.set('response_type', 'code');
    // openid is what makes the token response carry an id_token; without it we
    // are back to fetching /userinfo with a bearer token and trusting an
    // unsigned JSON body for `email_verified`.
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    return url.toString();
  }

  /**
   * Exchange the authorization code and read the identity out of the id_token.
   *
   * The id_token is a JWT signed by Google, so `email_verified` arrives with a
   * signature over it. The alternative - GET /userinfo with the access token -
   * returns the same fields in an unsigned body whose integrity rests entirely
   * on the transport.
   */
  async exchangeCode(code: string): Promise<GoogleProfile> {
    const config = this.requireConfig();
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.callbackUrl,
        grant_type: 'authorization_code',
      }),
    });
    if (!response.ok) throw new UnauthorizedException('Google sign-in failed');

    const tokens = (await response.json()) as { id_token?: unknown };
    if (typeof tokens.id_token !== 'string') {
      throw new UnauthorizedException('Google sign-in failed');
    }

    const { payload } = await jwtVerify(tokens.id_token, this.jwks, {
      issuer: GOOGLE_ISSUERS,
      // Binds the token to THIS client. A token minted for a different
      // application is signed by the same Google keys and would otherwise
      // verify here perfectly well.
      audience: config.clientId,
    });

    const email = payload['email'];
    const sub = payload.sub;
    if (typeof email !== 'string' || typeof sub !== 'string') {
      throw new UnauthorizedException('Google sign-in failed');
    }
    const name = payload['name'];
    return {
      provider: GOOGLE_PROVIDER,
      providerAccountId: sub,
      email: email.toLowerCase(),
      emailVerified: payload['email_verified'] === true,
      displayName: typeof name === 'string' && name.length > 0 ? name : email,
    };
  }

  /**
   * Find, link, or create - in that order.
   *
   * Identity is platform-owned (PRD 6.2), so this runs with a null tenant, the
   * same as every other path in AuthService.
   */
  async upsertFromProfile(profile: GoogleProfile): Promise<LinkedUser> {
    /**
     * THE guard. Auto-linking on an unverified address is full account
     * takeover: anyone who can get a token issued claiming
     * `victim@example.test` inherits the victim's NexMarket account, password
     * and all.
     *
     * SiloCRM's callback reads `verified_email` off the profile and never
     * checks it - the hole is live in a shipped codebase, which is why this is
     * a hard throw with a test rather than a validation nicety.
     */
    if (!profile.emailVerified) {
      throw new UnauthorizedException('Google sign-in failed');
    }

    return withTenant({ tenantId: null, userId: null, isAdmin: false }, async (tx) => {
      const linked = await this.findByIdentity(tx, profile);
      if (linked !== null) return { user: linked };

      const existing = await this.findByEmail(tx, profile.email);
      if (existing !== null) {
        await this.linkIdentity(tx, existing.id, profile);
        return { user: existing };
      }

      const created = await tx
        .insert(schema.users)
        .values({
          email: profile.email,
          displayName: profile.displayName,
          // No password. `verifyPassword` returns false for a null hash rather
          // than treating it as "any password matches", so this account cannot
          // be logged into with a password until it sets one.
          passwordHash: null,
          // Google asserted it, and the assertion was checked above.
          emailVerifiedAt: new Date(),
        })
        .onConflictDoNothing({ target: schema.users.email })
        .returning({
          id: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
        });

      // No row means a concurrent callback created the account first; read it
      // back rather than failing a login that is legitimate.
      const user = created[0] ?? (await this.findByEmail(tx, profile.email));
      if (user === null || user === undefined) {
        throw new UnauthorizedException('Google sign-in failed');
      }

      await this.linkIdentity(tx, user.id, profile);
      return { user };
    });
  }

  private async linkIdentity(
    tx: Transaction,
    userId: string,
    profile: GoogleProfile,
  ): Promise<void> {
    await tx
      .insert(schema.userIdentities)
      .values({
        userId,
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
      })
      // Two concurrent callbacks for the same account both reach here; the
      // unique index decides and neither fails.
      .onConflictDoNothing();
  }

  private async findByIdentity(
    tx: Transaction,
    profile: GoogleProfile,
  ): Promise<LinkedUser['user'] | null> {
    const rows = await tx
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        status: schema.users.status,
      })
      .from(schema.userIdentities)
      .innerJoin(schema.users, eq(schema.users.id, schema.userIdentities.userId))
      .where(
        and(
          eq(schema.userIdentities.provider, profile.provider),
          eq(schema.userIdentities.providerAccountId, profile.providerAccountId),
        ),
      )
      .limit(1);
    return this.activeOnly(rows[0]);
  }

  private async findByEmail(tx: Transaction, email: string): Promise<LinkedUser['user'] | null> {
    const rows = await tx
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        status: schema.users.status,
      })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    return this.activeOnly(rows[0]);
  }

  /**
   * A suspended account must not be reachable through the side door. Password
   * login checks status; if this did not, Google would be a way around it.
   */
  private activeOnly(row: UserRow | undefined): LinkedUser['user'] | null {
    if (row === undefined) return null;
    if (row.status !== 'ACTIVE') throw new UnauthorizedException('Google sign-in failed');
    return { id: row.id, email: row.email, displayName: row.displayName };
  }
}
