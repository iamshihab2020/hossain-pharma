'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { authResponseSchema, endpoints } from '@nexmarket/api-client';
import {
  ACCESS_COOKIE,
  API_REFRESH_COOKIE,
  ApiError,
  REFRESH_COOKIE,
  SESSION_COOKIE_OPTIONS,
  apiRaw,
  valueFromSetCookie,
} from '@/lib/api/server';
import { textField } from '@/lib/form';
import { mergeGuestCart } from './cart';

/**
 * Sign-in and registration.
 *
 * The API returns the access token in the body and sets the refresh token as an
 * httpOnly cookie scoped to `/auth` ON ITS OWN ORIGIN. Since the browser never
 * talks to the API, that cookie would never be sent back - so the value is
 * lifted out of the `Set-Cookie` header and re-set here, on our origin, under
 * our own name.
 *
 * Neither token is ever readable from JavaScript. That is the point of putting
 * the API behind the Next server rather than exposing it with CORS.
 */

export type AuthState = { error: string | null };

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 86_400;

async function storeSession(accessToken: string, setCookie: readonly string[]): Promise<void> {
  const jar = await cookies();

  jar.set(ACCESS_COOKIE, accessToken, {
    ...SESSION_COOKIE_OPTIONS,
    // Slightly under the token's own 15 minutes, so the cookie expires before
    // the token does rather than after - an expired token in a live cookie is a
    // 401 the middleware cannot see coming.
    maxAge: ACCESS_TTL_SECONDS - 30,
  });

  const refresh = valueFromSetCookie(setCookie, API_REFRESH_COOKIE);
  if (refresh !== null) {
    jar.set(REFRESH_COOKIE, refresh, { ...SESSION_COOKIE_OPTIONS, maxAge: REFRESH_TTL_SECONDS });
  }
}

export async function signIn(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const email = textField(formData, 'email');
  const password = textField(formData, 'password');
  const next = textField(formData, 'next', '/');

  if (email === '' || password === '') {
    return { error: 'Enter your email and password.' };
  }

  try {
    const { status, body, setCookie } = await apiRaw(endpoints.login().path, {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    if (status !== 200) throw new ApiError(status, body);

    const parsed = authResponseSchema.parse(body);
    await storeSession(parsed.accessToken, setCookie);
  } catch (error) {
    // Deliberately one message for both "no such account" and "wrong password".
    // Distinguishing them tells an attacker which half to keep.
    if (error instanceof ApiError && error.status === 401) {
      return { error: 'That email and password do not match an account.' };
    }
    return { error: 'Sign-in is unavailable right now. Try again in a moment.' };
  }

  // PRD 9.1: the guest cart merges on sign-in. After the session is stored, so
  // the call is authenticated, and outside the try/catch because a failed merge
  // must not read as a failed sign-in.
  await mergeGuestCart();
  revalidatePath('/', 'layout');
  redirect(safeNext(next));
}

export async function register(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const email = textField(formData, 'email');
  const password = textField(formData, 'password');
  const displayName = textField(formData, 'displayName');
  const next = textField(formData, 'next', '/');

  if (displayName.trim() === '') return { error: 'Enter your name.' };
  // Mirrors the API's rule (NIST 800-63B: length beats character classes), and
  // says so before a round trip rather than after.
  if (password.length < 12) return { error: 'Use a password of at least 12 characters.' };

  try {
    const { status, body, setCookie } = await apiRaw(endpoints.register().path, {
      method: 'POST',
      body: { email, password, displayName },
      auth: false,
    });
    if (status !== 201 && status !== 200) throw new ApiError(status, body);

    const parsed = authResponseSchema.parse(body);
    await storeSession(parsed.accessToken, setCookie);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { error: 'An account already uses that email. Sign in instead.' };
    }
    if (error instanceof ApiError && error.status === 400) {
      return { error: error.message };
    }
    return { error: 'That account could not be created. Try again in a moment.' };
  }

  await mergeGuestCart();
  revalidatePath('/', 'layout');
  redirect(safeNext(next));
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const refresh = jar.get(REFRESH_COOKIE)?.value;

  if (refresh !== undefined) {
    try {
      await apiRaw('/auth/logout', {
        method: 'POST',
        auth: false,
        // The API reads its OWN cookie name. We store the value under ours, so
        // it has to be named explicitly here or the server keeps the session
        // alive while the browser believes it is signed out.
        cookie: `${API_REFRESH_COOKIE}=${refresh}`,
      });
    } catch {
      // The local session is cleared either way. A logout that failed
      // server-side must not leave the browser signed in.
    }
  }

  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  revalidatePath('/', 'layout');
  redirect('/');
}

/**
 * Only same-site paths are followed after sign-in.
 *
 * `?next=https://elsewhere.example` would otherwise make this an open redirect,
 * which is the classic way a sign-in page becomes a phishing hop.
 */
function safeNext(next: string): string {
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}
