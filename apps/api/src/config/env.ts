import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),

  // --- Identity (PRD 13) ----------------------------------------------------
  /**
   * Minimum 32 bytes. A short secret makes HS256 forgeable, so this is a floor,
   * not a style rule.
   */
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_DOMAIN: z.string().default('localhost'),
  /**
   * Parsed as a literal, NOT with z.coerce.boolean(): coercion runs
   * Boolean("false"), which is true, so COOKIE_SECURE=false would silently
   * enable it. An env flag that cannot be turned off is worse than no flag.
   */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
  /**
   * Where the OAuth callback sends the browser once the cookie is set.
   *
   * A single fixed destination, NOT a `?redirect=` the caller supplies. An
   * attacker-controlled redirect on a route that has just minted a session is
   * an open redirect that hands the session away; SiloCRM carries a whole
   * origin-allowlist module (its FINDING-010/020) because it accepted one.
   * Adding a redirect parameter later means adding that allowlist first.
   */
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),

  // --- Seller documents (PRD 9.2 step 4, plan D-D) ---------------------------
  /**
   * Where the local FileStorage adapter writes. A directory, never a URL: the
   * object-storage adapter that replaces it will read its own variables, and
   * overloading this one to sometimes mean a bucket is how a path ends up
   * concatenated onto an endpoint.
   */
  FILE_STORAGE_DIR: z.string().default('.nexmarket/uploads'),

  // --- Payments (PRD 10.1) --------------------------------------------------
  /**
   * The shared secret a payment gateway signs its webhooks with.
   *
   * A default exists so the suite and a fresh clone run without configuration,
   * and it is 32 bytes for the same reason the JWT secrets are: this signature
   * is the ONLY thing standing between an anonymous POST and a ledger entry
   * saying a buyer paid. In production it is per-provider and rotated.
   */
  PAYMENT_WEBHOOK_SECRET: z.string().min(32).default('nexmarket-dev-webhook-secret-change-me'),
});

export type ApiEnv = z.infer<typeof schema>;

/**
 * Fails the boot on a missing or malformed variable rather than surfacing it as
 * an undefined at request time.
 */
export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid API environment: ${detail}`);
  }
  return parsed.data;
}
