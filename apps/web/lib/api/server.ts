import 'server-only';
import { cookies } from 'next/headers';
import { apiErrorSchema, type Endpoint } from '@nexmarket/api-client';

/**
 * The whole of the web app's contact with the API.
 *
 * **The browser never talks to the API directly, and cannot.** No CORS is
 * registered on the Nest app, which is not an oversight to route around - it is
 * the shape the cookie design already assumes. The refresh token is httpOnly
 * and the access token is meant to stay out of JavaScript, so putting the API
 * behind the Next server keeps both true and leaves one origin to reason about.
 *
 *   browser --(same-origin, Next cookies)--> Next server --(bearer)--> API
 *
 * That is also why there is no HTTP client library here. `fetch` is not plain
 * fetch in Next: it carries the data cache (`next: { revalidate, tags }`), and
 * axios or ky would bypass it, turning one cached catalogue render into one API
 * call per visitor. A client-side cache (SWR, TanStack Query) has nothing to
 * cache because the browser makes no API calls. Both earn their place the day
 * something genuinely interactive appears - search typeahead is the first
 * candidate - and not before.
 *
 * Reads happen in Server Components; writes happen in Server Actions, which are
 * the only place `cookies().set()` is legal. That constraint is real and shapes
 * `getCart`: a GET that minted a guest token would drop it on the floor.
 */

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

/** Our own cookies, on our own origin. Named apart from the API's deliberately. */
export const ACCESS_COOKIE = 'nm_at';
export const REFRESH_COOKIE = 'nm_rt';

/** The API's cookie names, which we speak only when talking to the API. */
export const API_CART_COOKIE = 'nexmarket_cart';
export const API_REFRESH_COOKIE = 'nexmarket_refresh';

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

/**
 * A failed API call, with the body preserved and parsed.
 *
 * `code` is the reason this is not flattened to a string: checkout answers 409
 * `PRICE_CHANGED` carrying the old and new totals, and the checkout page shows
 * that difference rather than a generic apology. `AGE_CHECK_REQUIRED` means
 * "ask for a date of birth", which is a form, not an error.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly expected: { amount: number; currency: string } | null;
  readonly actual: { amount: number; currency: string } | null;

  constructor(status: number, body: unknown) {
    const parsed = apiErrorSchema.safeParse(body);
    const data = parsed.success ? parsed.data : {};
    const message =
      typeof data.message === 'string'
        ? data.message
        : Array.isArray(data.message)
          ? data.message.join('; ')
          : `Request failed with ${String(status)}`;

    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = data.code ?? null;
    this.expected = data.expected ?? null;
    this.actual = data.actual ?? null;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Send the caller's session. Off for sign-in and other anonymous calls. */
  auth?: boolean;
  /** Send the guest cart cookie. Only the cart routes read it. */
  cart?: boolean;
  /**
   * Extra cookies to speak to the API, as a raw header value.
   *
   * The API's auth routes read `nexmarket_refresh` from a cookie, and we store
   * that value under our own name on our own origin - so the only way to hand
   * it back is to name it explicitly here. Logout and refresh both need it.
   */
  cookie?: string;
  /**
   * The seller organisation this request acts for, sent as `x-tenant-id`.
   *
   * Only the seller console sets it. The API validates it as a UUID and then
   * checks membership before any query runs, so this is a REQUEST to act as
   * that org rather than a claim to be it - the interceptor decides.
   */
  tenantId?: string;
  /** Next's data cache. The public catalogue revalidates; nothing personal does. */
  revalidate?: number | false;
  tags?: string[];
};

export type RawResponse = {
  status: number;
  body: unknown;
  /** Raw `set-cookie` lines from the API, for a caller that may adopt them. */
  setCookie: string[];
};

/** The transport. Returns the raw body; parsing is the caller's job, because
 *  only the caller knows which schema applies. */
export async function apiRaw(path: string, options: RequestOptions = {}): Promise<RawResponse> {
  const {
    method = 'GET',
    body,
    auth = true,
    cart = false,
    cookie,
    tenantId,
    revalidate = false,
    tags,
  } = options;

  const jar = await cookies();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (tenantId !== undefined) headers['x-tenant-id'] = tenantId;

  if (auth) {
    const token = jar.get(ACCESS_COOKIE)?.value;
    if (token !== undefined) headers['authorization'] = `Bearer ${token}`;
  }

  // Both sources are joined rather than one overwriting the other: a signed-in
  // buyer merging a guest cart needs the cart cookie AND the refresh cookie in
  // the same request, and a second assignment would silently drop one.
  const jarCookies: string[] = [];
  if (cart) {
    const token = jar.get(API_CART_COOKIE)?.value;
    if (token !== undefined) jarCookies.push(`${API_CART_COOKIE}=${token}`);
  }
  if (cookie !== undefined && cookie !== '') jarCookies.push(cookie);
  if (jarCookies.length > 0) headers['cookie'] = jarCookies.join('; ');

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    // A personal response cached in a shared cache is a data leak, and it is
    // the kind that looks fine in development where there is one user. So the
    // default is no-store and callers opt in per route.
    ...(revalidate === false
      ? { cache: 'no-store' as const }
      : { next: { revalidate, ...(tags === undefined ? {} : { tags }) } }),
  });

  const setCookie = readSetCookie(response);
  if (response.status === 204) return { status: 204, body: null, setCookie };

  const text = await response.text();
  return { status: response.status, body: text === '' ? null : safeJson(text), setCookie };
}

/**
 * Calls an endpoint and PARSES it through the contract schema.
 *
 * The parse is the point. `@nexmarket/api-client` declares what each response
 * must look like and `apps/api/test/contract.e2e.test.ts` asserts the server
 * agrees - so a shape change fails in CI on the API side, and if one ever slips
 * past, it fails here at the boundary rather than as an `undefined` three
 * components deep in a page nobody opened.
 */
export async function apiCall<T>(
  descriptor: Endpoint<T>,
  options: RequestOptions = {},
): Promise<{ data: T; setCookie: string[] }> {
  const { status, body, setCookie } = await apiRaw(descriptor.path, options);
  if (status < 200 || status >= 300) throw new ApiError(status, body);
  return { data: descriptor.schema.parse(body), setCookie };
}

/** The common case: a read whose cookies nobody needs to adopt. */
export async function apiGet<T>(
  descriptor: Endpoint<T>,
  options: Omit<RequestOptions, 'method' | 'body'> = {},
): Promise<T> {
  const { data } = await apiCall(descriptor, { ...options, method: 'GET' });
  return data;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

/**
 * `getSetCookie` is the only correct reader here: a single `set-cookie` header
 * lookup joins multiple cookies with a comma, and cookie values legally contain
 * commas (`Expires=Wed, 09 Jun 2027`), so splitting the joined string corrupts
 * them. Undici has had `getSetCookie` since Node 20.
 */
function readSetCookie(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = response.headers.get('set-cookie');
  return single === null ? [] : [single];
}

/** Pulls one cookie's value out of a set of `set-cookie` header lines. */
export function valueFromSetCookie(setCookie: readonly string[], name: string): string | null {
  for (const line of setCookie) {
    const [pair] = line.split(';');
    if (pair === undefined) continue;
    const index = pair.indexOf('=');
    if (index === -1) continue;
    if (pair.slice(0, index).trim() !== name) continue;
    return pair.slice(index + 1).trim();
  }
  return null;
}

/** Whether this request carries a session, without asking the API. */
export async function isSignedIn(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(ACCESS_COOKIE) !== undefined;
}
