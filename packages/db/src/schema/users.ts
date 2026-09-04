import { index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/**
 * PRD 5.1. BUYER and ADMIN only, deliberately.
 *
 * There is no SELLER value and adding one is a regression. Seller capability
 * comes from membership in an organisation (org_members), never from a field on
 * the user. The legacy system made roles mutually exclusive - verifySeller
 * rejected admins, verifyAdmin rejected sellers - so an admin could not manage
 * their own products. This enum's shape is what prevents that. See plan D-C.
 */
export const platformRole = pgEnum('platform_role', ['BUYER', 'ADMIN']);

export const userStatus = pgEnum('user_status', ['ACTIVE', 'SUSPENDED', 'DELETED']);

/**
 * Platform-owned (PRD 6.2): no tenant_id, no RLS. Buyers are not tenants; they
 * belong to the platform and shop across all sellers.
 *
 * passwordHash is nullable on purpose: an account created through Google OAuth
 * has no password until it sets one, and a null hash must never be treated as
 * "any password matches". Task 8's verify path checks for null explicitly.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stored lower-cased by the application. The unique index is what enforces it. */
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    platformRole: platformRole('platform_role').notNull().default('BUYER'),
    status: userStatus('status').notNull().default('ACTIVE'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /** Retained by the ETL so a migrated row can be traced back to its Mongo original. */
    legacyMongoId: text('legacy_mongo_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('users_email_key').on(t.email)],
);

/**
 * One row per external identity provider linked to a user. Google OAuth lands
 * here rather than on `users`, so a single account can carry a password AND a
 * Google login AND whatever provider Phase 9 adds, without a column per vendor.
 *
 * D6 dropped Firebase entirely. Every legacy account is invalid by construction.
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('user_identities_provider_account_key').on(t.provider, t.providerAccountId),
    index('user_identities_user_idx').on(t.userId),
  ],
);

/**
 * A refresh token FAMILY, not a token. See plan D-B.
 *
 * refreshTokenHash holds the SHA-256 of the currently valid refresh token.
 * Presenting a token that hashes to something else, while this row is alive,
 * means a superseded token was replayed - so the whole family is revoked. That
 * is the reuse detection PRD 13 requires; a row-per-token cannot express it,
 * because a legitimately rotated token and a stolen one look identical once the
 * old row is gone.
 *
 * SHA-256 rather than argon2id is deliberate: these are 256 bits of
 * crypto.randomBytes, not user-chosen secrets, so a slow KDF buys nothing and
 * would put ~100ms on every refresh.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * The family this row belongs to. Rotation INSERTS a new row sharing this
     * id and revokes the previous one with reason `rotated`, rather than
     * updating one row in place - the superseded hash has to survive, or a
     * replayed token is indistinguishable from an unknown one and reuse
     * detection cannot work at all.
     *
     * Revocation on reuse targets the family, not the user: one stolen token
     * kills that login, not every device the person is signed in on.
     */
    familyId: uuid('family_id').notNull().defaultRandom(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    /**
     * Rotation counter. Integer, not text: Task 7 increments it in SQL, and a
     * text column would force a parse-and-write round trip that two concurrent
     * refreshes could interleave. The plan specified text; this is the one
     * deviation from it in this task.
     */
    generation: integer('generation').notNull().default(0),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_hash_idx').on(t.refreshTokenHash),
    index('sessions_family_idx').on(t.familyId),
  ],
);
