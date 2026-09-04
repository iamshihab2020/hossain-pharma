import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { parseLimit } from '../../common/pagination.js';

export type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'newest';

const sortSchema = z.enum(['relevance', 'price_asc', 'price_desc', 'newest']);

export type SearchQuery = {
  q?: string;
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  attributes?: Record<string, string>;
  sort?: SortKey;
  cursor?: string;
  limit: number;
};

/**
 * Every filter arrives as a query-string value, so everything here is a string
 * until it is checked. The point of parsing rather than casting is that a
 * malformed `minPrice` becomes a 400 instead of reaching the query as `NaN`,
 * where `min_price_amount >= NaN` is silently false and the caller sees an
 * empty result page they cannot explain.
 */
const numeric = z.coerce.number().int().min(0);

const ATTRIBUTE_PREFIX = 'attr.';
const MAX_ATTRIBUTE_FILTERS = 10;

export function parseSearchQuery(raw: Record<string, unknown>): SearchQuery {
  const query: SearchQuery = { limit: parseLimit(str(raw['limit'])) };

  const q = str(raw['q']);
  // Trimmed and length-capped. websearch_to_tsquery handles arbitrary input
  // without throwing, but a multi-kilobyte term is a pointless GIN lookup and
  // an obvious way to make the p95 budget somebody else's problem.
  if (q !== undefined && q.trim() !== '') query.q = q.trim().slice(0, 200);

  const category = str(raw['category']);
  if (category !== undefined && category !== '') query.category = category;

  const brand = str(raw['brand']);
  if (brand !== undefined && brand !== '') query.brand = brand;

  const minPrice = str(raw['minPrice']);
  if (minPrice !== undefined && minPrice !== '') query.minPrice = parse(numeric, minPrice, 'minPrice');

  const maxPrice = str(raw['maxPrice']);
  if (maxPrice !== undefined && maxPrice !== '') query.maxPrice = parse(numeric, maxPrice, 'maxPrice');

  if (
    query.minPrice !== undefined &&
    query.maxPrice !== undefined &&
    query.minPrice > query.maxPrice
  ) {
    // An inverted range always returns nothing. Saying so beats an empty page
    // the caller reads as "no such products".
    throw new BadRequestException('minPrice must not exceed maxPrice');
  }

  const inStock = str(raw['inStock']);
  if (inStock !== undefined && inStock !== '') {
    // Compared as a literal, never coerced: Boolean('false') is true, and a
    // filter that cannot be turned off is worse than no filter.
    if (inStock !== 'true' && inStock !== 'false') {
      throw new BadRequestException('inStock must be true or false');
    }
    query.inStock = inStock === 'true';
  }

  const sort = str(raw['sort']);
  if (sort !== undefined && sort !== '') query.sort = parse(sortSchema, sort, 'sort');

  const cursor = str(raw['cursor']);
  if (cursor !== undefined && cursor !== '') query.cursor = cursor;

  // Per-category attribute filters arrive as `attr.colour=Violet`. Collected
  // here rather than as a free-form object so an unrelated query parameter can
  // never reach the attribute predicate.
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith(ATTRIBUTE_PREFIX)) continue;
    const name = key.slice(ATTRIBUTE_PREFIX.length);
    const text = str(value);
    if (name === '' || text === undefined || text === '') continue;
    attributes[name] = text;
  }
  if (Object.keys(attributes).length > MAX_ATTRIBUTE_FILTERS) {
    // Each attribute filter is an EXISTS subquery. An unbounded number of them
    // is a query a caller can make arbitrarily expensive from a URL.
    throw new BadRequestException(`At most ${MAX_ATTRIBUTE_FILTERS} attribute filters`);
  }
  if (Object.keys(attributes).length > 0) query.attributes = attributes;

  return query;
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  // Fastify gives an array when a parameter repeats. Taking the first is the
  // same rule the tenant header uses, and it is at least predictable.
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function parse<T>(schema: { safeParse: (v: unknown) => SafeParse<T> }, value: string, field: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(`Invalid ${field}`);
  return parsed.data;
}

type SafeParse<T> = { success: true; data: T } | { success: false };

export const saveSearchSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  query: z.record(z.string(), z.string()),
});

export type SaveSearchInput = z.infer<typeof saveSearchSchema>;
