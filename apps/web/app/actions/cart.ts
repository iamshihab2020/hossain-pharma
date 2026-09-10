'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { endpoints } from '@nexmarket/api-client';
import {
  ApiError,
  API_CART_COOKIE,
  apiCall,
  apiRaw,
  valueFromSetCookie,
} from '@/lib/api/server';

/**
 * Cart mutations.
 *
 * Server Actions rather than a client data library, because the browser cannot
 * reach the API at all - no CORS is registered on the Nest app, deliberately,
 * so that the tokens stay httpOnly. These run on the Next server, which holds
 * the session.
 *
 * They are also the ONLY place the guest cart cookie can be adopted: a Server
 * Component may read cookies but not set them, so a `GET /cart` that minted a
 * token would throw it away. See `getCart` in lib/api/queries.ts.
 */

export type CartActionResult = { ok: true } | { ok: false; message: string };

/**
 * The guest cookie is minted by the API and re-set on OUR origin.
 *
 * The value is copied rather than the whole `Set-Cookie` line replayed: the
 * API's attributes describe the API's origin, and blindly forwarding them is
 * how a cookie ends up with a path or a domain that quietly never matches.
 */
async function adoptCartCookie(setCookie: readonly string[]): Promise<void> {
  const minted = valueFromSetCookie(setCookie, API_CART_COOKIE);
  if (minted === null) return;

  const jar = await cookies();
  if (jar.get(API_CART_COOKIE)?.value === minted) return;

  jar.set(API_CART_COOKIE, minted, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Matches the API's own 30 days. A shorter one here would drop the cookie
    // while the cart row it points at was still alive.
    maxAge: 30 * 86_400,
  });
}

/** Every cart mutation changes the header badge, which every page renders. */
function refreshCartSurfaces(): void {
  revalidatePath('/', 'layout');
}

export async function addToCart(listingId: string, quantity = 1): Promise<CartActionResult> {
  try {
    const { setCookie } = await apiCall(endpoints.cartItems(), {
      method: 'POST',
      body: { listingId, quantity },
      cart: true,
    });
    await adoptCartCookie(setCookie);
    refreshCartSurfaces();
    return { ok: true };
  } catch (error) {
    return failure(error, 'This item could not be added to your cart.');
  }
}

export async function setQuantity(itemId: string, quantity: number): Promise<CartActionResult> {
  try {
    await apiCall(endpoints.cartItem(itemId), {
      method: 'PATCH',
      body: { quantity },
      cart: true,
    });
    refreshCartSurfaces();
    return { ok: true };
  } catch (error) {
    return failure(error, 'That quantity could not be set.');
  }
}

export async function removeItem(itemId: string): Promise<CartActionResult> {
  try {
    await apiCall(endpoints.cartItem(itemId), { method: 'DELETE', cart: true });
    refreshCartSurfaces();
    return { ok: true };
  } catch (error) {
    return failure(error, 'That item could not be removed.');
  }
}

/**
 * PRD 9.1: the guest cart merges into the member cart on sign-in.
 *
 * Called right after a successful sign-in, while the guest cookie is still
 * present. Failure here is deliberately NOT surfaced as a sign-in error - the
 * person is signed in either way, and blocking that on a cart merge would be
 * the wrong trade. The quantities are summed by the API, so a repeat call is
 * safe.
 */
export async function mergeGuestCart(): Promise<void> {
  const jar = await cookies();
  if (jar.get(API_CART_COOKIE) === undefined) return;

  try {
    await apiRaw(endpoints.cartMerge().path, { method: 'POST', cart: true });
    // The guest token has served its purpose. Leaving it would mean the next
    // sign-out reattached a cart that now belongs to a member.
    jar.delete(API_CART_COOKIE);
    refreshCartSurfaces();
  } catch {
    // Logged nowhere on purpose for now: there is no client-side error channel
    // yet, and a merge that failed leaves the guest cart intact to retry.
  }
}

function failure(error: unknown, fallback: string): CartActionResult {
  // The API's message is the useful one where it exists - "Bengal Tech has
  // stopped selling" beats any string this file could invent.
  if (error instanceof ApiError) return { ok: false, message: error.message };
  return { ok: false, message: fallback };
}
