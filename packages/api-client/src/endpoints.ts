import type { z } from 'zod';
import {
  addressSchema,
  addressesResponse,
  authResponseSchema,
  cartViewSchema,
  categoriesResponse,
  categoryProductsResponse,
  confirmationSchema,
  myOrgsResponse,
  orderDetailSchema,
  ordersResponse,
  shipmentViewSchema,
  productPageSchema,
  quoteSchema,
  searchResultSchema,
  similarResponse,
  suggestResponse,
  type SortKey,
} from './schemas.js';

/**
 * Every endpoint the storefront uses, as a path plus the schema its response
 * must satisfy.
 *
 * **Deliberately transport-free.** There is no fetch, no axios, no client
 * instance here - only a description. The web app's BFF supplies the transport
 * because it needs Next's extended `fetch` (the `next: { revalidate, tags }`
 * data cache), and the API's e2e suite supplies its own because it drives an
 * in-process server. Baking a transport in would force one of them to work
 * around it.
 *
 * That is also why this file is the thing both sides share: a path typo or a
 * changed response shape shows up in the one place, rather than in each
 * caller's private string literal.
 */

export type Endpoint<T> = {
  readonly path: string;
  readonly schema: z.ZodType<T>;
};

function endpoint<T>(path: string, schema: z.ZodType<T>): Endpoint<T> {
  return { path, schema };
}

export type SearchQuery = {
  q?: string;
  category?: string;
  brand?: string;
  inStock?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sort?: SortKey;
  cursor?: string;
  limit?: number;
};

/**
 * Query strings are built HERE rather than at each call site.
 *
 * The API rejects an unknown or malformed parameter with a 400 rather than
 * ignoring it - a deliberate choice on its side - so a caller that invents
 * `pageSize` gets an error page, not a default. One builder means one place
 * where the parameter names are either right or obviously wrong.
 */
export function searchQueryString(query: SearchQuery): string {
  const params = new URLSearchParams();
  if (query.q !== undefined && query.q.trim() !== '') params.set('q', query.q.trim());
  if (query.category !== undefined && query.category !== '') params.set('category', query.category);
  if (query.brand !== undefined && query.brand !== '') params.set('brand', query.brand);
  if (query.inStock === true) params.set('inStock', 'true');
  if (query.minPrice !== undefined) params.set('minPrice', String(query.minPrice));
  if (query.maxPrice !== undefined) params.set('maxPrice', String(query.maxPrice));
  // `relevance` is the server's default; sending it adds noise to the cache key
  // for no behavioural difference.
  if (query.sort !== undefined && query.sort !== 'relevance') params.set('sort', query.sort);
  if (query.cursor !== undefined && query.cursor !== '') params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const rendered = params.toString();
  return rendered === '' ? '' : `?${rendered}`;
}

export const endpoints = {
  // ---- public catalogue -----------------------------------------------------
  categories: () => endpoint('/categories', categoriesResponse),

  categoryProducts: (slug: string) =>
    endpoint(`/categories/${encodeURIComponent(slug)}/products`, categoryProductsResponse),

  product: (slug: string) =>
    endpoint(`/products/${encodeURIComponent(slug)}`, productPageSchema),

  /** Returns SEARCH HITS, not product summaries. The two look alike and are not
   *  the same shape, which is exactly the kind of thing this file pins down. */
  similar: (slug: string) =>
    endpoint(`/products/${encodeURIComponent(slug)}/similar`, similarResponse),

  search: (query: SearchQuery) =>
    endpoint(`/search${searchQueryString(query)}`, searchResultSchema),

  /** Under two characters the API answers an empty list rather than scanning. */
  suggest: (term: string) =>
    endpoint(`/search/suggest?q=${encodeURIComponent(term)}`, suggestResponse),

  // ---- cart (public, guest or member) ---------------------------------------
  cart: () => endpoint('/cart', cartViewSchema),
  cartItems: () => endpoint('/cart/items', cartViewSchema),
  cartItem: (id: string) => endpoint(`/cart/items/${encodeURIComponent(id)}`, cartViewSchema),
  cartMerge: () => endpoint('/cart/merge', cartViewSchema),

  // ---- authenticated --------------------------------------------------------
  addresses: () => endpoint('/me/addresses', addressesResponse),
  address: (id: string) => endpoint(`/me/addresses/${encodeURIComponent(id)}`, addressSchema),
  createAddress: () => endpoint('/me/addresses', addressSchema),

  quote: (addressId: string) =>
    endpoint(`/checkout/quote?addressId=${encodeURIComponent(addressId)}`, quoteSchema),
  confirm: () => endpoint('/checkout/confirm', confirmationSchema),

  orders: (cursor?: string) =>
    endpoint(
      `/me/orders${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
      ordersResponse,
    ),
  order: (id: string) => endpoint(`/me/orders/${encodeURIComponent(id)}`, orderDetailSchema),

  /** Whole-order only. Dropping one item of several is a return, Phase 8. */
  cancelOrder: (id: string) =>
    endpoint(`/me/orders/${encodeURIComponent(id)}/cancel`, orderDetailSchema),

  /** Which organisations this person can act for. */
  myOrgs: () => endpoint('/orgs/mine', myOrgsResponse),

  // ---- seller fulfilment ----------------------------------------------------
  //
  // Every one of these is a VERB. Nothing takes a status to set: the status is a
  // consequence of what the verb did, computed from line coverage.

  sellerOrders: (cursor?: string) =>
    endpoint(
      `/seller/orders${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
      ordersResponse,
    ),
  sellerOrder: (id: string) =>
    endpoint(`/seller/orders/${encodeURIComponent(id)}`, orderDetailSchema),
  acceptOrder: (id: string) =>
    endpoint(`/seller/orders/${encodeURIComponent(id)}/accept`, orderDetailSchema),
  rejectOrder: (id: string) =>
    endpoint(`/seller/orders/${encodeURIComponent(id)}/reject`, orderDetailSchema),
  createShipment: (id: string) =>
    endpoint(`/seller/orders/${encodeURIComponent(id)}/shipments`, shipmentViewSchema),
  markDelivered: (id: string, shipmentId: string) =>
    endpoint(
      `/seller/orders/${encodeURIComponent(id)}/shipments/${encodeURIComponent(shipmentId)}/delivered`,
      shipmentViewSchema,
    ),
  cancelLines: (id: string) =>
    endpoint(`/seller/orders/${encodeURIComponent(id)}/cancel`, orderDetailSchema),

  // ---- auth -----------------------------------------------------------------
  register: () => endpoint('/auth/register', authResponseSchema),
  login: () => endpoint('/auth/login', authResponseSchema),
  refresh: () => endpoint('/auth/refresh', authResponseSchema),
} as const;
