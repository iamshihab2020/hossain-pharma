import { describe, expect, it } from 'vitest';
import { endpoints, searchQueryString } from './endpoints.js';
import { moneySchema, productPageSchema, searchResultSchema } from './schemas.js';

/**
 * These test the parts of the contract that are CODE rather than declaration.
 *
 * The schemas themselves are asserted against real API responses in
 * `apps/api/test/contract.e2e.test.ts` - a schema tested only against a fixture
 * this file wrote proves the fixture matches the schema and nothing about the
 * server.
 */

describe('searchQueryString', () => {
  it('omits everything the server already defaults', () => {
    // An empty query string means "the default search", and the API caches on
    // the URL. Emitting `?sort=relevance&limit=20` for the default would split
    // the cache for no behavioural difference.
    expect(searchQueryString({})).toBe('');
    expect(searchQueryString({ sort: 'relevance' })).toBe('');
    expect(searchQueryString({ q: '   ' })).toBe('');
  });

  it('keeps a non-default sort', () => {
    expect(searchQueryString({ sort: 'sellers' })).toBe('?sort=sellers');
  });

  it('trims the term rather than sending the whitespace', () => {
    expect(searchQueryString({ q: '  redmi  ' })).toBe('?q=redmi');
  });

  it('encodes a term that would otherwise break the query string', () => {
    // A buyer searching for "tea & coffee" must not produce a second parameter.
    const rendered = searchQueryString({ q: 'tea & coffee' });
    expect(rendered).toContain('tea+%26+coffee');
    expect(new URLSearchParams(rendered.slice(1)).get('q')).toBe('tea & coffee');
  });

  it('sends inStock only when it is true', () => {
    // `inStock=false` and "no filter" are the same query, and the API treats an
    // absent filter as "either". Sending false would be a third state nothing
    // implements.
    expect(searchQueryString({ inStock: false })).toBe('');
    expect(searchQueryString({ inStock: true })).toBe('?inStock=true');
  });

  it('sends a zero minimum price, which is not the same as no filter', () => {
    // 0 is falsy, so a `if (query.minPrice)` guard would silently drop it.
    expect(searchQueryString({ minPrice: 0 })).toBe('?minPrice=0');
  });
});

describe('endpoint paths', () => {
  it('encodes a slug that contains a slash', () => {
    // Slugs are generated, but a hand-entered URL reaching `/products/a/b`
    // would hit a different route entirely and 404 confusingly.
    expect(endpoints.product('a/b').path).toBe('/products/a%2Fb');
  });

  it('omits the cursor parameter on the first page', () => {
    expect(endpoints.orders().path).toBe('/me/orders');
    expect(endpoints.orders('abc').path).toBe('/me/orders?cursor=abc');
  });
});

describe('schemas', () => {
  it('rejects a money amount that arrived as a string', () => {
    // A raw `tx.execute` skips Drizzle's column mapping and can return a bigint
    // as a string. That has happened in this codebase before; the schema is
    // where it stops being silent.
    expect(moneySchema.safeParse({ amount: '3160000', currency: 'BDT' }).success).toBe(false);
    expect(moneySchema.safeParse({ amount: 3_160_000, currency: 'BDT' }).success).toBe(true);
  });

  it('rejects a float amount', () => {
    // Money is integer minor units everywhere. A float here means someone
    // divided by 100 upstream.
    expect(moneySchema.safeParse({ amount: 31_600.5, currency: 'BDT' }).success).toBe(false);
  });

  it('requires the buy box to declare its basis', () => {
    const withoutBasis = {
      id: 'p1',
      slug: 'x',
      name: 'X',
      brand: null,
      description: null,
      category: { slug: 'c', name: 'C', path: 'c', isRestricted: false },
      attributes: [],
      media: [],
      variants: [
        { id: 'v1', sku: 'S', name: 'S', buyBox: { otherSellerCount: 0, winner: null, offers: [] } },
      ],
    };
    // The basis is what lets the page say it ranked on a flat rate rather than
    // a quote to the buyer's address. A response without it must not parse.
    expect(productPageSchema.safeParse(withoutBasis).success).toBe(false);
  });

  it('requires nextCursor to be present and nullable, not absent', () => {
    const base = { items: [], total: 0, facets: { category: [], brand: [], availability: [], price: [], attributes: [] } };
    expect(searchResultSchema.safeParse(base).success).toBe(false);
    expect(searchResultSchema.safeParse({ ...base, nextCursor: null }).success).toBe(true);
  });
});
