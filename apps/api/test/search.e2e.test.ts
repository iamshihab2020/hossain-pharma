import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import { sql } from 'drizzle-orm';
import { withTenant } from '@nexmarket/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';

/**
 * PRD 9.1 discovery, and the Phase 3 acceptance criteria.
 *
 * EVERY PRODUCT THIS FILE CREATES LIVES IN `fresh-produce`, and every facet
 * assertion is scoped to it. Vitest runs test files in parallel against one
 * database, so a facet count taken over the whole catalogue would move whenever
 * another file publishes something. No other suite writes to that category, and
 * none writes as this SELLER - the same discipline as namespacing test emails,
 * applied to the taxonomy and to the tenant.
 */
let app: NestFastifyApplication;

const SEED_PASSWORD = 'nexmarket-demo';
const CATEGORY = 'fresh-produce';

type Session = { accessToken: string; tenantId: string };
type Facet = { value: string; label: string; count: number };
type SearchBody = {
  items: {
    slug: string;
    name: string;
    brand: string | null;
    price: { amount: number } | null;
    sellerCount: number;
  }[];
  total: number;
  nextCursor: string | null;
  facets: {
    category: Facet[];
    brand: Facet[];
    availability: Facet[];
    price: Facet[];
    attributes: { key: string; label: string; values: Facet[] }[];
  };
};

let seller: Session;
let admin: string;

/**
 * Four products, two brands, two origins, one deliberately out of stock.
 *
 * Enough that a facet has more than one value to drill into, and small enough
 * that every expected count can be worked out by hand rather than by running
 * the code under test and writing down what it said.
 */
const FIXTURES = [
  { slug: 'search-alphonso-mango', name: 'Alphonso Mango Crate', brand: 'Verdant', origin: 'Rangpur', price: 45_000, stock: 20 },
  { slug: 'search-himsagar-mango', name: 'Himsagar Mango Crate', brand: 'Verdant', origin: 'Sylhet', price: 52_000, stock: 8 },
  { slug: 'search-sylhet-pineapple', name: 'Sylhet Pineapple Box', brand: 'Harvest', origin: 'Sylhet', price: 31_000, stock: 15 },
  { slug: 'search-jackfruit-whole', name: 'Whole Jackfruit', brand: 'Harvest', origin: 'Rangpur', price: 120_000, stock: 0 },
] as const;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  // nadia is MANAGER in meridian-fashion, which gives her product:write and
  // nothing this suite does not need. Deliberately NOT karim/acme: the listings
  // suite samples "acme's newest ACTIVE listing", and four produce fixtures
  // published here would silently become the listing that suite then asserts
  // about. Sellers are shared fixture state, exactly like seeded users.
  seller = await sessionFor('nadia@acme.test', 'meridian-fashion');
  admin = (await login('admin@nexmarket.test')).accessToken;

  for (const fixture of FIXTURES) await publish(fixture);
}, 180_000);

afterAll(async () => {
  await app?.close();
});

async function login(email: string): Promise<{ accessToken: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: SEED_PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return { accessToken: res.json<{ accessToken: string }>().accessToken };
}

async function sessionFor(email: string, orgSlug: string): Promise<Session> {
  const { accessToken } = await login(email);
  const orgs = await app.inject({
    method: 'GET',
    url: '/orgs/mine',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const org = orgs
    .json<{ items: { id: string; slug: string }[] }>()
    .items.find((o) => o.slug === orgSlug);
  if (org === undefined) throw new Error(`${email} is not in ${orgSlug}`);
  return { accessToken, tenantId: org.id };
}

function asSeller(method: 'GET' | 'POST' | 'PUT', url: string, payload?: Record<string, unknown>) {
  const base = {
    method,
    url,
    headers: { authorization: `Bearer ${seller.accessToken}`, 'x-tenant-id': seller.tenantId },
  };
  return payload === undefined ? app.inject(base) : app.inject({ ...base, payload });
}

/** propose → approve → list → stock → publish, the whole path a product takes to be findable. */
async function publish(fixture: (typeof FIXTURES)[number]): Promise<void> {
  const proposed = await asSeller('POST', '/products', {
    categorySlug: CATEGORY,
    slug: fixture.slug,
    name: fixture.name,
    brand: fixture.brand,
    description: 'Seasonal produce, sold by the crate.',
    variants: [{ sku: `${fixture.slug.toUpperCase()}-1`, name: 'Default' }],
    attributes: [{ key: 'origin', text: fixture.origin }],
  });
  if (proposed.statusCode !== 201) throw new Error(`propose failed: ${proposed.body}`);
  const productId = proposed.json<{ id: string; variants: { id: string }[] }>().id;
  const variantId = proposed.json<{ variants: { id: string }[] }>().variants[0]?.id;

  const approved = await app.inject({
    method: 'POST',
    url: `/admin/products/${productId}/approve`,
    headers: { authorization: `Bearer ${admin}` },
  });
  if (approved.statusCode !== 201) throw new Error(`approve failed: ${approved.body}`);

  const listing = await asSeller('POST', '/listings', {
    variantId,
    priceAmount: fixture.price,
    priceCurrency: 'BDT',
  });
  if (listing.statusCode !== 201) throw new Error(`list failed: ${listing.body}`);
  const listingId = listing.json<{ id: string }>().id;

  const warehouses = await asSeller('GET', '/warehouses');
  const warehouseId = warehouses.json<{ items: { id: string }[] }>().items[0]?.id;

  if (fixture.stock > 0) {
    await asSeller('PUT', `/listings/${listingId}/inventory`, {
      warehouseId,
      onHand: fixture.stock,
    });
    const published = await asSeller('POST', `/listings/${listingId}/publish`);
    if (published.statusCode !== 201) throw new Error(`publish failed: ${published.body}`);
  }
  // A zero-stock fixture is deliberately left in DRAFT: publishing is refused
  // without stock, which is the Phase 2 rule, so "out of stock" here means "has
  // a catalogue entry and no eligible offer".
}

function search(qs: string): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'GET', url: `/search?${qs}` });
}

const inCategory = `category=${CATEGORY}`;

describe('the search index', () => {
  /**
   * THE DRIFT TEST, and the reason the reindex hooks are verifiable rather than
   * a claim.
   *
   * `search_documents` is maintained incrementally by a fixed list of call
   * sites. A write path added without a reindex leaves a stale row, and nothing
   * about a stale row looks wrong - the API answers, the numbers are plausible,
   * and they are yesterday's. Comparing the table to the view it is built from
   * is the only check that catches a hook nobody added.
   *
   * The fixtures above have already exercised propose, approve, create, stock
   * and publish; the suspension case gets its own test below.
   */
  it('agrees with the view it is materialised from, after every write path', async () => {
    const drift = await withTenant({ tenantId: null, userId: null, isAdmin: false }, (tx) =>
      tx.execute<{ product_id: string; reason: string }>(sql`
        SELECT s.product_id, 'missing from the index' AS reason
          FROM search_document_source s
          LEFT JOIN search_documents d ON d.product_id = s.product_id
         WHERE d.product_id IS NULL
        UNION ALL
        SELECT d.product_id, 'stale: no longer in the source' AS reason
          FROM search_documents d
          LEFT JOIN search_document_source s ON s.product_id = d.product_id
         WHERE s.product_id IS NULL
        UNION ALL
        SELECT d.product_id, 'values disagree' AS reason
          FROM search_documents d
          JOIN search_document_source s ON s.product_id = d.product_id
         WHERE (d.name, d.brand, d.category_id, d.search_text, d.min_price_amount,
                d.seller_count, d.in_stock)
            IS DISTINCT FROM
               (s.name, s.brand, s.category_id, s.search_text, s.min_price_amount,
                s.seller_count, s.in_stock)
      `),
    );
    expect(drift.rows).toEqual([]);
  });

  it('indexes a product only once it is published, and drops it when it is not', async () => {
    // A DRAFT product has no public page, so a search result linking to it
    // would be the only way to discover what sellers have proposed.
    const draft = await asSeller('POST', '/products', {
      categorySlug: CATEGORY,
      slug: 'search-unapproved-okra',
      name: 'Unapproved Okra',
      brand: 'Verdant',
      variants: [{ sku: 'SEARCH-OKRA-1', name: 'Default' }],
    });
    expect(draft.statusCode).toBe(201);
    const hidden = await search(`q=okra&${inCategory}`);
    expect(hidden.json<SearchBody>().items.map((i) => i.slug)).not.toContain(
      'search-unapproved-okra',
    );
  });
});

describe('typo tolerance', () => {
  /** PRD 11: "typo tolerance verified". Not "implemented" - verified. */
  it.each([
    ['alphonzo', 'search-alphonso-mango'],
    ['pineaple', 'search-sylhet-pineapple'],
    ['jackfruite', 'search-jackfruit-whole'],
    ['himsager', 'search-himsagar-mango'],
  ])('finds the right product from the misspelling %s', async (typo, slug) => {
    const res = await search(`q=${typo}&${inCategory}`);
    expect(res.statusCode).toBe(200);
    expect(res.json<SearchBody>().items.map((i) => i.slug)).toContain(slug);
  });

  it('still ranks an exact match above a fuzzy one', async () => {
    // Trigram similarity alone would let a near-miss outrank the word the
    // person actually typed. The rank adds lexical rank to similarity for
    // exactly this reason.
    const res = await search(`q=pineapple&${inCategory}`);
    expect(res.json<SearchBody>().items[0]?.slug).toBe('search-sylhet-pineapple');
  });

  it('returns nothing for a term that resembles nothing, rather than everything', async () => {
    // The failure mode of a too-low trigram threshold: every query matches, and
    // search silently becomes a catalogue dump.
    const res = await search(`q=zzzzqqqqxxxx&${inCategory}`);
    expect(res.json<SearchBody>().items).toEqual([]);
    expect(res.json<SearchBody>().total).toBe(0);
  });

  it('matches on brand and on category name, not only on the product name', async () => {
    const byBrand = await search(`q=Harvest&${inCategory}`);
    expect(byBrand.json<SearchBody>().items.length).toBeGreaterThanOrEqual(2);
  });
});

describe('facets', () => {
  /**
   * THE PRD 11 BLOCKING CRITERION: "facet counts match filtered results exactly".
   *
   * Asserted in a loop over every value of every facet, not spot-checked: the
   * interesting failures are the values nobody thought to check.
   */
  it('reports counts that exactly match what filtering by them returns', async () => {
    const base = await search(`${inCategory}&limit=100`);
    const facets = base.json<SearchBody>().facets;

    for (const brand of facets.brand) {
      const filtered = await search(`${inCategory}&brand=${encodeURIComponent(brand.value)}&limit=100`);
      expect(`brand=${brand.value} -> ${filtered.json<SearchBody>().total}`).toBe(
        `brand=${brand.value} -> ${brand.count}`,
      );
    }

    for (const attribute of facets.attributes) {
      for (const value of attribute.values) {
        const filtered = await search(
          `${inCategory}&attr.${attribute.key}=${encodeURIComponent(value.value)}&limit=100`,
        );
        expect(`${attribute.key}=${value.value} -> ${filtered.json<SearchBody>().total}`).toBe(
          `${attribute.key}=${value.value} -> ${value.count}`,
        );
      }
    }

    for (const availability of facets.availability) {
      if (availability.value !== 'in_stock') continue;
      const filtered = await search(`${inCategory}&inStock=true&limit=100`);
      expect(filtered.json<SearchBody>().total).toBe(availability.count);
    }
  });

  it('keeps a facet drillable by excluding it from its own counts', async () => {
    // With Brand: Verdant selected, the Brand facet must still say how many
    // results Harvest would give - otherwise the filter can never be changed.
    // Applying every filter to every facet would report zero here, which is
    // trivially "exact" and useless.
    const res = await search(`${inCategory}&brand=Verdant&limit=100`);
    const brands = res.json<SearchBody>().facets.brand;
    expect(brands.find((b) => b.value === 'Verdant')?.count).toBe(2);
    expect(brands.find((b) => b.value === 'Harvest')?.count).toBe(2);
    // The RESULTS, however, are filtered.
    expect(res.json<SearchBody>().total).toBe(2);
  });

  it('narrows another facet when a filter is applied', async () => {
    // The other half: a facet that is NOT excluded does narrow. Without this,
    // a build that dropped every filter from every facet would pass the test
    // above.
    const all = await search(`${inCategory}&limit=100`);
    const filtered = await search(`${inCategory}&brand=Verdant&limit=100`);
    const originsAll = all.json<SearchBody>().facets.attributes.find((a) => a.key === 'origin');
    const originsFiltered = filtered
      .json<SearchBody>()
      .facets.attributes.find((a) => a.key === 'origin');
    expect(originsAll?.values.find((v) => v.value === 'Sylhet')?.count).toBe(2);
    expect(originsFiltered?.values.find((v) => v.value === 'Sylhet')?.count).toBe(1);
  });

  it('offers per-category facets only when a category is chosen', async () => {
    // The union of every category's attributes is a filter list nobody can
    // read, so an unscoped search offers none.
    const scoped = await search(`${inCategory}`);
    const unscoped = await search('q=mango');
    expect(scoped.json<SearchBody>().facets.attributes.map((a) => a.key)).toContain('origin');
    expect(unscoped.json<SearchBody>().facets.attributes).toEqual([]);
  });

  it('offers only attributes the category marked facetable', async () => {
    // `organic` is an attribute of fresh produce and is NOT facetable, which is
    // the column that separates a filter from a spec line.
    const res = await search(`${inCategory}`);
    expect(res.json<SearchBody>().facets.attributes.map((a) => a.key)).not.toContain('organic');
  });

  it('reports the four fixture products in this category, and the one with no offer', async () => {
    const res = await search(`${inCategory}&limit=100`);
    const body = res.json<SearchBody>();
    const mine = body.items.filter((i) => i.slug.startsWith('search-'));
    expect(mine).toHaveLength(4);
    // Whole Jackfruit has a catalogue entry and no eligible offer, so it is
    // findable and priceless - which is the honest rendering of "out of stock".
    expect(mine.find((i) => i.slug === 'search-jackfruit-whole')?.price).toBeNull();
  });
});

describe('sorting and paging', () => {
  it('sorts by price ascending, with unpriced products last', async () => {
    // A product nobody offers has no price. Sorting it to the top of "cheapest
    // first" is the wrong answer in the most visible possible place.
    const res = await search(`${inCategory}&sort=price_asc&limit=100`);
    const mine = res.json<SearchBody>().items.filter((i) => i.slug.startsWith('search-'));
    expect(mine.map((i) => i.slug)).toEqual([
      'search-sylhet-pineapple',
      'search-alphonso-mango',
      'search-himsagar-mango',
      'search-jackfruit-whole',
    ]);
  });

  it('sorts by price descending, still with unpriced products last', async () => {
    const res = await search(`${inCategory}&sort=price_desc&limit=100`);
    const mine = res.json<SearchBody>().items.filter((i) => i.slug.startsWith('search-'));
    expect(mine[mine.length - 1]?.slug).toBe('search-jackfruit-whole');
    expect(mine[0]?.slug).toBe('search-himsagar-mango');
  });

  it('pages without repeating or skipping a product', async () => {
    const first = await search(`${inCategory}&sort=newest&limit=2`);
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<SearchBody>();
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await search(
      `${inCategory}&sort=newest&limit=2&cursor=${encodeURIComponent(firstBody.nextCursor as string)}`,
    );
    const firstSlugs = firstBody.items.map((i) => i.slug);
    const secondSlugs = second.json<SearchBody>().items.map((i) => i.slug);
    expect(secondSlugs.filter((s) => firstSlugs.includes(s))).toEqual([]);
  });

  it('rejects a bad filter rather than returning an empty page', async () => {
    // `min_price_amount >= NaN` is silently false, and the caller sees an empty
    // result they cannot explain.
    expect((await search('minPrice=abc')).statusCode).toBe(400);
    expect((await search('minPrice=500&maxPrice=100')).statusCode).toBe(400);
    expect((await search('inStock=yes')).statusCode).toBe(400);
    expect((await search('sort=cheapest')).statusCode).toBe(400);
  });
});

describe('suspension reaches the index', () => {
  /**
   * The least obvious reindex hook, and the reason it has its own test.
   *
   * Suspending a seller withdraws every one of their offers, so the cheapest
   * price and the seller count change on products the admin never looked at.
   * Nothing about `POST /admin/orgs/:id/suspend` looks like it touches search.
   */
  it('withdraws a suspended sellers offers from search, and restores them on reinstatement', async () => {
    /**
     * Selected by slug, never as items[0].
     *
     * "Himsagar" is a real mango variety and the demo market seeds one too, so
     * this query legitimately returns more than one product. Worse, ranking
     * MOVES as the test runs: once suspension strips the fixture's price and
     * seller count, it stops sorting first, and items[0] silently becomes
     * somebody else's product that was never suspended. The assertion then
     * reads a healthy row and reports the reindex as broken.
     */
    const mine = (res: LightMyRequestResponse) =>
      res.json<SearchBody>().items.find((i) => i.slug === 'search-himsagar-mango');

    const before = await search('q=Himsagar');
    expect(mine(before)?.price).not.toBeNull();

    const suspend = await app.inject({
      method: 'POST',
      url: `/admin/orgs/${seller.tenantId}/suspend`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { reason: 'Search index coverage test' },
    });
    expect(suspend.statusCode).toBe(201);

    const during = await search('q=Himsagar');
    // Still findable - the catalogue entry is real - but with no price and no
    // sellers, because nobody is offering it.
    expect(mine(during)?.price).toBeNull();
    expect(mine(during)?.sellerCount).toBe(0);

    const reinstate = await app.inject({
      method: 'POST',
      url: `/admin/orgs/${seller.tenantId}/reinstate`,
      headers: { authorization: `Bearer ${admin}` },
    });
    expect(reinstate.statusCode).toBe(201);

    const after = await search('q=Himsagar');
    expect(mine(after)?.price).not.toBeNull();
  });
});

describe('autocomplete, similar products and history', () => {
  it('suggests on a prefix', async () => {
    const res = await app.inject({ method: 'GET', url: '/search/suggest?q=Alph' });
    expect(res.json<{ items: { slug: string }[] }>().items.map((i) => i.slug)).toContain(
      'search-alphonso-mango',
    );
  });

  it('suggests through a typo', async () => {
    const res = await app.inject({ method: 'GET', url: '/search/suggest?q=Jackfruite' });
    expect(res.json<{ items: { slug: string }[] }>().items.map((i) => i.slug)).toContain(
      'search-jackfruit-whole',
    );
  });

  it('says nothing for a one-character term', async () => {
    // One character is a scan of the catalogue, not a suggestion.
    const res = await app.inject({ method: 'GET', url: '/search/suggest?q=a' });
    expect(res.json<{ items: unknown[] }>().items).toEqual([]);
  });

  it('recommends similar products from the same category, never the product itself', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/products/search-alphonso-mango/similar',
    });
    const slugs = res.json<{ items: { slug: string }[] }>().items.map((i) => i.slug);
    expect(slugs).not.toContain('search-alphonso-mango');
    expect(slugs).toContain('search-himsagar-mango');
  });

  it('records and returns a members recently viewed products, newest first', async () => {
    const buyer = await login('rina@buyer.test');
    const auth = { authorization: `Bearer ${buyer.accessToken}` };

    for (const slug of ['search-alphonso-mango', 'search-sylhet-pineapple']) {
      const res = await app.inject({
        method: 'POST',
        url: `/me/recently-viewed/${slug}`,
        headers: auth,
      });
      expect(res.statusCode).toBe(201);
    }

    const history = await app.inject({ method: 'GET', url: '/me/recently-viewed', headers: auth });
    expect(history.json<{ items: { slug: string }[] }>().items[0]?.slug).toBe(
      'search-sylhet-pineapple',
    );
  });

  it('keeps one row per product however often it is viewed', async () => {
    const buyer = await login('rina@buyer.test');
    const auth = { authorization: `Bearer ${buyer.accessToken}` };
    for (let i = 0; i < 3; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/me/recently-viewed/search-jackfruit-whole',
        headers: auth,
      });
    }
    const history = await app.inject({ method: 'GET', url: '/me/recently-viewed', headers: auth });
    const jackfruit = history
      .json<{ items: { slug: string }[] }>()
      .items.filter((i) => i.slug === 'search-jackfruit-whole');
    expect(jackfruit).toHaveLength(1);
  });

  it('refuses history and saved searches to an anonymous caller', async () => {
    expect((await app.inject({ method: 'GET', url: '/me/recently-viewed' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/me/saved-searches' })).statusCode).toBe(401);
  });

  it('saves a search, lists it, and refuses to show it to anyone else', async () => {
    const mine = await login('rina@buyer.test');
    const theirs = await login('nadia@acme.test');

    const saved = await app.inject({
      method: 'POST',
      url: '/me/saved-searches',
      headers: { authorization: `Bearer ${mine.accessToken}` },
      payload: { name: 'Cheap mangoes', query: { q: 'mango', sort: 'price_asc' } },
    });
    expect(saved.statusCode).toBe(201);
    const id = saved.json<{ id: string }>().id;

    const listed = await app.inject({
      method: 'GET',
      url: '/me/saved-searches',
      headers: { authorization: `Bearer ${mine.accessToken}` },
    });
    expect(listed.json<{ items: { id: string }[] }>().items.map((s) => s.id)).toContain(id);

    const other = await app.inject({
      method: 'GET',
      url: '/me/saved-searches',
      headers: { authorization: `Bearer ${theirs.accessToken}` },
    });
    expect(other.json<{ items: { id: string }[] }>().items.map((s) => s.id)).not.toContain(id);

    // And they cannot delete it either. There is no policy behind this table -
    // the user-id filter in the service IS the boundary, so it is tested.
    const theirDelete = await app.inject({
      method: 'DELETE',
      url: `/me/saved-searches/${id}`,
      headers: { authorization: `Bearer ${theirs.accessToken}` },
    });
    expect(theirDelete.statusCode).toBe(404);

    const myDelete = await app.inject({
      method: 'DELETE',
      url: `/me/saved-searches/${id}`,
      headers: { authorization: `Bearer ${mine.accessToken}` },
    });
    expect(myDelete.statusCode).toBe(200);
  });
});
