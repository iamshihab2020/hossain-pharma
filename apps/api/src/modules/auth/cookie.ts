import { loadApiEnv } from '../../config/env.js';

export const REFRESH_COOKIE = 'nexmarket_refresh';

const env = loadApiEnv();

/**
 * PRD 13: httpOnly, no token in JS.
 *
 * path is scoped to /auth so the refresh token is not attached to every API
 * call - it is only ever needed by the auth controllers, and a cookie that
 * travels everywhere is a cookie that leaks everywhere.
 *
 * sameSite lax rather than strict: strict drops the cookie on the top-level
 * navigation back from the Google OAuth callback, which would silently log the
 * user out at the end of a successful sign-in.
 *
 * Shared by both controllers on purpose. Two copies of these options is two
 * chances to set the OAuth path's cookie slightly weaker than the password
 * path's, and nothing would fail visibly if that happened.
 */
export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.COOKIE_SECURE,
  path: '/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400,
} as const;
