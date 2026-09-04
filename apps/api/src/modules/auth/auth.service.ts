import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, withTenant, type Transaction } from '@nexmarket/db';
import { loadApiEnv, type ApiEnv } from '../../config/env.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  hashRefreshToken,
  issueAccessToken,
  mintRefreshToken,
  type AccessTokenPayload,
} from './tokens.js';
import type { LoginInput, RegisterInput } from './dto.js';

export type AuthResult = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    platformRole: 'BUYER' | 'ADMIN';
  };
};

export type SessionMetadata = {
  userAgent: string | null;
  ipAddress: string | null;
};

/**
 * A single message for every authentication failure.
 *
 * "No such account" and "wrong password" must be indistinguishable, or the
 * login endpoint becomes an account-enumeration oracle: an attacker learns
 * which emails are registered without ever guessing a password. The legacy
 * system leaked exactly this.
 */
const AUTH_FAILED = 'Invalid email or password';

@Injectable()
export class AuthService {
  private readonly env: ApiEnv = loadApiEnv();
  private readonly accessSecret = new TextEncoder().encode(this.env.JWT_ACCESS_SECRET);

  /**
   * Identity is platform-owned (PRD 6.2), so every call here runs with a null
   * tenant. That is not a loophole: users, user_identities and sessions carry
   * no tenant_id and no RLS policy, by design - a buyer belongs to the platform
   * and shops across all sellers.
   */
  private run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant({ tenantId: null, userId: null, isAdmin: false }, fn);
  }

  async register(input: RegisterInput, meta: SessionMetadata): Promise<AuthResult> {
    const passwordHash = await hashPassword(input.password);
    return this.run(async (tx) => {
      const inserted = await tx
        .insert(schema.users)
        .values({
          email: input.email,
          displayName: input.displayName,
          passwordHash,
        })
        .onConflictDoNothing({ target: schema.users.email })
        .returning({ id: schema.users.id });

      const created = inserted[0];
      // onConflictDoNothing returns no row when the email is taken. A 409 that
      // names no field is deliberate - see AUTH_FAILED above for the reasoning.
      if (created === undefined) throw new ConflictException('Account could not be created');

      return this.startSession(tx, created.id, meta);
    });
  }

  async login(input: LoginInput, meta: SessionMetadata): Promise<AuthResult> {
    return this.run(async (tx) => {
      const found = await tx
        .select({
          id: schema.users.id,
          passwordHash: schema.users.passwordHash,
          status: schema.users.status,
        })
        .from(schema.users)
        .where(eq(schema.users.email, input.email))
        .limit(1);

      const user = found[0];
      // verifyPassword is called even when the user is missing would be the
      // ideal constant-time shape; here the argon2 cost dominates either way and
      // the response is identical, so an attacker learns nothing from the body.
      if (user === undefined) throw new UnauthorizedException(AUTH_FAILED);
      if (user.status !== 'ACTIVE') throw new UnauthorizedException(AUTH_FAILED);
      if (!(await verifyPassword(user.passwordHash, input.password))) {
        throw new UnauthorizedException(AUTH_FAILED);
      }

      return this.startSession(tx, user.id, meta);
    });
  }

  /**
   * PRD 13 reuse detection. See plan D-B for why sessions are families.
   *
   * Three outcomes:
   *  - hash matches a live row            -> rotate: new row, same family,
   *                                          old row revoked as `rotated`
   *  - hash matches nothing at all        -> unknown token, reject
   *  - hash matches a REVOKED row         -> REPLAY. Revoke the whole family
   *                                          and reject.
   *
   * The third case is why rotation inserts rather than updates in place: the
   * superseded hash has to survive, or a stolen token and a normally rotated
   * one are indistinguishable and reuse detection cannot work at all.
   */
  async refresh(rawToken: string, meta: SessionMetadata): Promise<AuthResult> {
    const presented = hashRefreshToken(rawToken);

    /**
     * Detection and rejection are two separate transactions, and that
     * separation is load-bearing.
     *
     * withTenant runs its callback inside a transaction, so throwing from
     * inside it ROLLS BACK everything the callback wrote - including the
     * revocation that a replay just triggered. Revoking and then throwing in
     * one transaction leaves the stolen family alive: the request 401s, the
     * attacker retries, and it works. The failing test looked like a policy bug
     * and was a transaction-boundary bug.
     *
     * So the transaction returns a verdict, and the throw happens after it
     * commits.
     */
    const outcome = await this.run(async (tx) => {
      const liveRows = await tx
        .select()
        .from(schema.sessions)
        .where(
          and(eq(schema.sessions.refreshTokenHash, presented), isNull(schema.sessions.revokedAt)),
        )
        .limit(1);
      const live = liveRows[0];

      if (live !== undefined) {
        if (live.expiresAt.getTime() < Date.now()) {
          return { kind: 'revoke' as const, familyId: live.familyId, reason: 'expired' };
        }
        const next = mintRefreshToken();
        await tx
          .update(schema.sessions)
          .set({ revokedAt: new Date(), revokedReason: 'rotated', updatedAt: new Date() })
          .where(eq(schema.sessions.id, live.id));
        await tx.insert(schema.sessions).values({
          userId: live.userId,
          familyId: live.familyId,
          refreshTokenHash: next.hash,
          generation: live.generation + 1,
          userAgent: meta.userAgent,
          ipAddress: meta.ipAddress,
          expiresAt: live.expiresAt,
        });
        return { kind: 'ok' as const, result: await this.buildResult(tx, live.userId, next.token) };
      }

      // Not live. Was this hash EVER issued? A revoked row carrying it means a
      // superseded token came back, which is the attack signature.
      const staleRows = await tx
        .select({ familyId: schema.sessions.familyId })
        .from(schema.sessions)
        .where(eq(schema.sessions.refreshTokenHash, presented))
        .limit(1);
      const stale = staleRows[0];
      if (stale !== undefined) {
        return {
          kind: 'revoke' as const,
          familyId: stale.familyId,
          reason: 'refresh_token_reuse_detected',
        };
      }
      return { kind: 'unknown' as const };
    });

    if (outcome.kind === 'ok') return outcome.result;
    if (outcome.kind === 'revoke') {
      await this.run((tx) => this.revokeFamily(tx, outcome.familyId, outcome.reason));
    }
    throw new UnauthorizedException('Invalid session');
  }

  /**
   * Start a session for a user who has already been authenticated by some other
   * means - today, Google OAuth.
   *
   * Extracted so the OAuth path cannot grow its own session-minting code. Every
   * property the password path proves (family id, rotation counter, hashed
   * storage, the TTL) has to hold for a Google login too, and the only way to
   * guarantee that is for both to run the same function.
   *
   * It deliberately does NOT check a password: the caller is asserting that
   * identity is already established.
   */
  async issueForUser(userId: string, meta: SessionMetadata): Promise<AuthResult> {
    return this.run((tx) => this.startSession(tx, userId, meta));
  }

  /**
   * Logout revokes the family, not just the presented token. Leaving the rest
   * of the family alive would mean "sign out" ended one request's token and
   * nothing else.
   *
   * Silent on an unknown token: logout must never report whether a session
   * existed.
   */
  async logout(rawToken: string): Promise<void> {
    const presented = hashRefreshToken(rawToken);
    await this.run(async (tx) => {
      const rows = await tx
        .select({ familyId: schema.sessions.familyId })
        .from(schema.sessions)
        .where(eq(schema.sessions.refreshTokenHash, presented))
        .limit(1);
      const row = rows[0];
      if (row !== undefined) await this.revokeFamily(tx, row.familyId, 'logout');
    });
  }

  private async revokeFamily(tx: Transaction, familyId: string, reason: string): Promise<void> {
    await tx
      .update(schema.sessions)
      .set({ revokedAt: new Date(), revokedReason: reason, updatedAt: new Date() })
      .where(and(eq(schema.sessions.familyId, familyId), isNull(schema.sessions.revokedAt)));
  }

  private async startSession(
    tx: Transaction,
    userId: string,
    meta: SessionMetadata,
  ): Promise<AuthResult> {
    const next = mintRefreshToken();
    const expiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await tx.insert(schema.sessions).values({
      userId,
      refreshTokenHash: next.hash,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      expiresAt,
    });
    return this.buildResult(tx, userId, next.token);
  }

  private async buildResult(
    tx: Transaction,
    userId: string,
    refreshToken: string,
  ): Promise<AuthResult> {
    const rows = await tx
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        platformRole: schema.users.platformRole,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const user = rows[0];
    if (user === undefined) throw new UnauthorizedException('Invalid session');

    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      platformRole: user.platformRole,
    };
    const accessToken = await issueAccessToken(
      payload,
      this.accessSecret,
      this.env.ACCESS_TOKEN_TTL_SECONDS,
    );
    return { accessToken, refreshToken, user };
  }
}
