import 'server-only';
import { cookies } from 'next/headers';
import {
  endpoints,
  type Address,
  type CartView,
  type CategoryNode,
  type MyOrg,
  type OrderDetail,
  type OrderView,
  type ProductPage,
  type ProductSummary,
  type Quote,
  type SearchHit,
  type SearchQuery,
  type SearchResult,
} from '@nexmarket/api-client';
import { ACCESS_COOKIE, API_CART_COOKIE, apiGet } from './server';

/**
 * Every read the storefront performs, in one file, so the caching policy is
 * decided once rather than re-argued on each page.
 *
 * The rule: the public catalogue is cached, anything belonging to a person is
 * not. A cart or an order list served from a shared cache is a data leak, and
 * it is the kind that looks fine in development where there is one user.
 */

/** The catalogue changes whenever a seller reprices, so a minute, not an hour. */
const CATALOGUE_TTL = 60;

// ---- public catalogue -------------------------------------------------------

export async function getCategories(): Promise<CategoryNode[]> {
  const { items } = await apiGet(endpoints.categories(), {
    auth: false,
    revalidate: 300,
    tags: ['categories'],
  });
  return items;
}

export function getProduct(slug: string): Promise<ProductPage> {
  return apiGet(endpoints.product(slug), {
    auth: false,
    revalidate: CATALOGUE_TTL,
    tags: ['catalogue', `product:${slug}`],
  });
}

export async function getCategoryProducts(slug: string): Promise<ProductSummary[]> {
  const { items } = await apiGet(endpoints.categoryProducts(slug), {
    auth: false,
    revalidate: CATALOGUE_TTL,
    tags: ['catalogue', `category:${slug}`],
  });
  return items;
}

/** Returns SEARCH HITS rather than product summaries - the two look alike and
 *  are not the same shape. The contract package pins that down. */
export async function getSimilar(slug: string): Promise<SearchHit[]> {
  const { items } = await apiGet(endpoints.similar(slug), {
    auth: false,
    revalidate: CATALOGUE_TTL,
  });
  return items;
}

export function search(query: SearchQuery): Promise<SearchResult> {
  return apiGet(endpoints.search(query), {
    auth: false,
    revalidate: CATALOGUE_TTL,
    tags: ['catalogue'],
  });
}

/**
 * "Where sellers compete" - the home page's one rail.
 *
 * Ranked on `seller_count`, which the search index already materialises, so it
 * is an ORDER BY rather than a new aggregate. It is the ONLY rail on the home
 * page and it exists to show what the marketplace is, not to manufacture
 * urgency: no countdown, no "today only".
 */
export function getMostCompeted(): Promise<SearchResult> {
  return search({ sort: 'sellers', limit: 8, inStock: true });
}

// ---- the cart ---------------------------------------------------------------

/**
 * A guest with no cart cookie has an empty cart, and we answer that WITHOUT
 * calling the API.
 *
 * Not an optimisation. `GET /cart` mints a guest token for a caller who has
 * none, and a Server Component cannot set cookies - so the call would create a
 * cart row, hand back a token nothing can store, and do it again on every
 * render. The token is adopted in the add-to-cart Server Action instead, which
 * is allowed to write cookies.
 */
export async function getCart(): Promise<CartView> {
  const jar = await cookies();
  const hasCart = jar.get(API_CART_COOKIE) !== undefined;
  const hasSession = jar.get(ACCESS_COOKIE) !== undefined;
  if (!hasCart && !hasSession) return emptyCart();

  return apiGet(endpoints.cart(), { cart: true });
}

/** What a guest with no cookie has. Built here rather than imported as a
 *  constant so nothing can mutate a shared object between requests. */
export function emptyCart(): CartView {
  return {
    id: '',
    currency: 'BDT',
    groups: [],
    subtotal: { amount: 0, currency: 'BDT' },
    itemCount: 0,
    hasUnavailableLines: false,
  };
}

// ---- signed-in reads --------------------------------------------------------

export async function getAddresses(): Promise<Address[]> {
  const { items } = await apiGet(endpoints.addresses());
  return items;
}

export function getQuote(addressId: string): Promise<Quote> {
  return apiGet(endpoints.quote(addressId));
}

export function getOrders(cursor?: string): Promise<{ items: OrderView[]; nextCursor: string | null }> {
  return apiGet(endpoints.orders(cursor));
}

export function getOrder(id: string): Promise<OrderDetail> {
  return apiGet(endpoints.order(id));
}

/**
 * Which organisation the signed-in person is acting for in the seller console.
 *
 * The first one they belong to, for now. Multi-org switching is a real feature
 * with a real place to live - the designed console - and a half-built org
 * picker in a skeleton would be the wrong thing in the wrong place.
 *
 * Lives here rather than in the page because a Next route file may only export
 * the component and the framework's own hooks; an arbitrary helper exported
 * from `page.tsx` is a build error waiting for a version bump.
 */
export async function activeOrg(): Promise<MyOrg | null> {
  const mine = await apiGet(endpoints.myOrgs(), { auth: true });
  return mine.items[0] ?? null;
}
