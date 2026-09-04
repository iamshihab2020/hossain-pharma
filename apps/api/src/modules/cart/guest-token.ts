import { createHash, randomBytes } from 'node:crypto';
import { loadApiEnv } from '../../config/env.js';

export const CART_COOKIE = 'nexmarket_cart';

const env = loadApiEnv();

/**
 * PRD 9.1: "Guest cart merged on login".
 *
 * A guest has no user id, so the cart needs some other identity. It is an
 * opaque 256-bit token in an httpOnly cookie, stored as SHA-256 - the same
 * treatment `sessions` gives refresh tokens (ADR 0012), for the same reason: a
 * database dump must not be a set of live cart handles.
 *
 * Unlike the refresh cookie this one is NOT scoped to a single path, because
 * the cart is read and written across the whole storefront. It carries no
 * authority beyond "this is the same anonymous browser", which is exactly what
 * a cart needs and nothing more - a stolen cart token can add items to a
 * stranger's cart and cannot place an order, because checkout requires a
 * signed-in user.
 */
export const CART_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.COOKIE_SECURE,
  path: '/',
  maxAge: 30 * 86_400,
} as const;

export function mintGuestToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
