import { NextResponse, type NextRequest } from 'next/server';

/**
 * Keeps a session alive across the access token's 15-minute life.
 *
 * Named `proxy` in a `proxy.ts` file: Next 16 renamed the `middleware`
 * convention, and the old name builds with a deprecation warning rather than
 * failing, so it would have quietly stayed wrong.
 *
 * The refresh has to happen HERE and not in a page: a Server Component may read
 * cookies but not write them, so a component that noticed an expired token
 * could refresh it and would have nowhere to put the result. Middleware owns
 * the response, so it can.
 *
 * Only fires when the access cookie is gone and the refresh cookie is not,
 * which is exactly the window between the two expiries. A request carrying a
 * live access token costs nothing here.
 */

const ACCESS_COOKIE = 'nm_at';
const REFRESH_COOKIE = 'nm_rt';
const API_REFRESH_COOKIE = 'nexmarket_refresh';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 86_400;

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const hasAccess = request.cookies.get(ACCESS_COOKIE) !== undefined;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;

  if (hasAccess || refresh === undefined) return NextResponse.next();

  let response = NextResponse.next();

  try {
    const refreshed = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        // The API reads its own cookie name; ours is only a container.
        cookie: `${API_REFRESH_COOKIE}=${refresh}`,
      },
      cache: 'no-store',
    });

    if (!refreshed.ok) {
      // The refresh token is spent, revoked or expired. Clearing it stops every
      // subsequent request retrying a call that cannot succeed.
      response.cookies.delete(REFRESH_COOKIE);
      return response;
    }

    const body = (await refreshed.json()) as { accessToken?: unknown };
    if (typeof body.accessToken !== 'string') return response;

    response.cookies.set(ACCESS_COOKIE, body.accessToken, {
      ...COOKIE_OPTIONS,
      maxAge: ACCESS_TTL_SECONDS - 30,
    });

    // The API rotates the refresh token on every use (ADR 0012), so the new one
    // has to be stored or the NEXT refresh fails against a spent token.
    const rotated = readSetCookie(refreshed).find((line) =>
      line.startsWith(`${API_REFRESH_COOKIE}=`),
    );
    if (rotated !== undefined) {
      const value = rotated.slice(API_REFRESH_COOKIE.length + 1).split(';')[0];
      if (value !== undefined && value !== '') {
        response.cookies.set(REFRESH_COOKIE, value, {
          ...COOKIE_OPTIONS,
          maxAge: REFRESH_TTL_SECONDS,
        });
      }
    }
  } catch {
    // The API being unreachable must not take the storefront down with it. The
    // catalogue is public and renders fine without a session.
    response = NextResponse.next();
  }

  return response;
}

function readSetCookie(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = response.headers.get('set-cookie');
  return single === null ? [] : [single];
}

export const config = {
  /**
   * Everything except static assets and the Next internals.
   *
   * Deliberately NOT limited to the signed-in routes: the header renders a cart
   * badge on every page, and a member whose token lapsed while reading a
   * product page should not have to visit /orders before their cart reappears.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)'],
};
