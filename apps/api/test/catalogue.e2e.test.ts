import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';

/**
 * PRD 8.3 and the Phase 2 acceptance criterion, over HTTP and anonymously.
 *
 * "Two sellers list the same product at different prices; the product page
 * shows both with a correct buy-box winner."
 *
 * The fixture is the seed, not something built here: acme-electronics and
 * northwind-home both offer AUR-X1-128-VIO, and northwind has the cheaper
 * sticker price while acme has the cheaper landed price. A test that built its
 * own two-seller fixture could not accidentally prove the seed is wrong.
 */
let app: NestFastifyApplication;

const SEED_PASSWORD = 'nexmarket-demo';

type Session = { accessToken: string };
type Offer = {
  listingId: string;
  seller: { slug: string; displayName: string };
  price: { amount: number; currency: string };
  landedPrice: { amount: number; currency: string };
  availability: string;
  isWinner: boolean;
};
type BuyBoxBody = {
  basis: string;
  otherSellerCount: number;
  winner: Offer | null;
  offers: Offer[];
};
type ProductBody = {
  slug: string;
  name: string;
  category: { slug: string; isRestricted: boolean };
  attributes: { key: string; label: string; value: unknown }[];
  variants: { id: string; sku: string; buyBox: BuyBoxBody }[];
};
type CategoriesBody = {
  items: { slug: string; children: { slug: string; children: { slug: string }[] }[] }[];
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 90_000);

afterAll(async () => {
  await app?.close();
});

function get(url: string): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'GET', url });
}

async function login(email: string, password = SEED_PASSWORD): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return { accessToken: res.json<{ accessToken: string }>().accessToken };
}

function variantOf(product: ProductBody, sku: string): ProductBody['variants'][number] {
  const variant = product.variants.find((v) => v.sku === sku);
  if (variant === undefined) throw new Error(`no variant ${sku} on ${product.slug}`);
  return variant;
}

describe('the buyer catalogue', () => {
  it('serves the category tree to an anonymous visitor, three levels deep', async () => {
    const res = await get('/categories');
    expect(res.statusCode).toBe(200);
    const roots = res.json<CategoriesBody>().items;
    const electronics = roots.find((c) => c.slug === 'electronics');
    expect(electronics?.children.find((c) => c.slug === 'phones')?.children.map((c) => c.slug)).toEqual(
      ['smartphones'],
    );
  });

  it('browses a category by ltree subtree, so a parent includes its grandchildren', async () => {
    // `electronics` has no products of its own; `smartphones`, two levels down,
    // has one. A parent-id join would return nothing here.
    const res = await get('/categories/electronics/products');
    expect(res.statusCode).toBe(200);
    const slugs = res.json<{ items: { slug: string }[] }>().items.map((p) => p.slug);
    expect(slugs).toContain('aurora-x1');
  });

  it('404s an unknown category rather than returning an empty page', async () => {
    expect((await get('/categories/no-such-category/products')).statusCode).toBe(404);
  });

  /**
   * THE PRD 11 PHASE 2 ACCEPTANCE CRITERION.
   */
  it('shows both sellers on one product page with the correct buy-box winner', async () => {
    const res = await get('/products/aurora-x1');
    expect(res.statusCode).toBe(200);

    const product = res.json<ProductBody>();
    const buyBox = variantOf(product, 'AUR-X1-128-VIO').buyBox;

    expect(buyBox.offers).toHaveLength(2);
    expect(new Set(buyBox.offers.map((o) => o.seller.slug))).toEqual(
      new Set(['acme-electronics', 'northwind-home']),
    );
    expect(buyBox.otherSellerCount).toBe(1);

    // acme wins on LANDED price despite the HIGHER sticker price. A buy box
    // that ranked on the item price alone would name northwind here, and that
    // is the whole reason the fixture is shaped this way.
    expect(buyBox.winner?.seller.slug).toBe('acme-electronics');
    const northwind = buyBox.offers.find((o) => o.seller.slug === 'northwind-home');
    expect(northwind?.price.amount).toBeLessThan(buyBox.winner?.price.amount ?? 0);
    expect(northwind?.landedPrice.amount).toBeGreaterThan(buyBox.winner?.landedPrice.amount ?? 0);

    expect(buyBox.offers.filter((o) => o.isWinner)).toHaveLength(1);
  });

  it('says which basis the landed price was computed on', async () => {
    // Phase 2 has no delivery zones, so shipping is a flat per-listing figure.
    // A client that renders "delivered price" has to be able to tell.
    const product = (await get('/products/aurora-x1')).json<ProductBody>();
    expect(variantOf(product, 'AUR-X1-128-VIO').buyBox.basis).toBe('flat-shipping');
  });

  it('reports availability as a band, never an exact count', async () => {
    // An exact figure tells a competitor how fast a rival is selling. PRD 9.1
    // only ever asks for the band.
    const product = (await get('/products/aurora-x1')).json<ProductBody>();
    const offers = variantOf(product, 'AUR-X1-128-VIO').buyBox.offers;
    for (const offer of offers) {
      expect(['IN_STOCK', 'LOW_STOCK']).toContain(offer.availability);
      expect(Object.keys(offer)).not.toContain('availableStock');
    }
  });

  it('renders per-category attributes with their labels', async () => {
    const product = (await get('/products/aurora-x1')).json<ProductBody>();
    const screen = product.attributes.find((a) => a.key === 'screen_size_in');
    expect(screen?.label).toBe('Screen size (in)');
    expect(screen?.value).toBe(6.4);
    expect(product.attributes.find((a) => a.key === 'dual_sim')?.value).toBe(true);
  });

  it('shows an empty buy box for a variant nobody offers, rather than failing', async () => {
    const product = (await get('/products/harbour-single-malt')).json<ProductBody>();
    const buyBox = product.variants[0]?.buyBox;
    expect(buyBox?.winner).toBeNull();
    expect(buyBox?.offers).toEqual([]);
    expect(buyBox?.otherSellerCount).toBe(0);
  });

  it('marks a restricted category on the product page', async () => {
    // The Phase 4 age gate reads this, and the Phase 2 listing review path
    // routes on the same flag.
    const product = (await get('/products/harbour-single-malt')).json<ProductBody>();
    expect(product.category.isRestricted).toBe(true);
  });

  it('404s a product that is not published', async () => {
    // "Exists but unpublished" would let anyone enumerate what sellers have
    // proposed, so an unapproved product is simply not a page.
    const seller = await login('karim@acme.test');
    const orgs = await app.inject({
      method: 'GET',
      url: '/orgs/mine',
      headers: { authorization: `Bearer ${seller.accessToken}` },
    });
    const acme = orgs
      .json<{ items: { id: string; slug: string }[] }>()
      .items.find((o) => o.slug === 'acme-electronics');

    const proposed = await app.inject({
      method: 'POST',
      url: '/products',
      headers: {
        authorization: `Bearer ${seller.accessToken}`,
        'x-tenant-id': acme?.id ?? '',
      },
      payload: {
        categorySlug: 'headphones',
        slug: 'unapproved-cans',
        name: 'Unapproved Cans',
        variants: [{ sku: 'CAT-UNAPPROVED-1', name: 'Default' }],
      },
    });
    expect(proposed.statusCode).toBe(201);
    expect(proposed.json<{ status: string }>().status).toBe('PENDING_REVIEW');
    expect((await get('/products/unapproved-cans')).statusCode).toBe(404);
  });
});

describe('product moderation', () => {
  it('publishes a proposed product only after an admin approves it', async () => {
    const seller = await login('karim@acme.test');
    const orgs = await app.inject({
      method: 'GET',
      url: '/orgs/mine',
      headers: { authorization: `Bearer ${seller.accessToken}` },
    });
    const acmeId =
      orgs.json<{ items: { id: string; slug: string }[] }>().items.find((o) => o.slug === 'acme-electronics')
        ?.id ?? '';

    const proposed = await app.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${seller.accessToken}`, 'x-tenant-id': acmeId },
      payload: {
        categorySlug: 'headphones',
        slug: 'aurora-buds',
        name: 'Aurora Buds',
        brand: 'Aurora',
        variants: [{ sku: 'AUR-BUDS-1', name: 'Default' }],
        attributes: [{ key: 'form_factor', text: 'In-ear' }],
      },
    });
    expect(proposed.statusCode).toBe(201);
    const productId = proposed.json<{ id: string }>().id;

    expect((await get('/products/aurora-buds')).statusCode).toBe(404);

    const admin = await login('admin@nexmarket.test');
    const queue = await app.inject({
      method: 'GET',
      url: '/admin/products?status=PENDING_REVIEW',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(queue.json<{ items: { id: string }[] }>().items.map((p) => p.id)).toContain(productId);

    const approved = await app.inject({
      method: 'POST',
      url: `/admin/products/${productId}/approve`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(approved.statusCode).toBe(201);
    expect((await get('/products/aurora-buds')).statusCode).toBe(200);
  });

  it('refuses a proposal from a seller who lacks product:write', async () => {
    // tanvir is FINANCE in acme, and FINANCE has no Products column in PRD 5.3.
    const finance = await login('tanvir@acme.test');
    const orgs = await app.inject({
      method: 'GET',
      url: '/orgs/mine',
      headers: { authorization: `Bearer ${finance.accessToken}` },
    });
    const acmeId = orgs.json<{ items: { id: string }[] }>().items[0]?.id ?? '';

    const res = await app.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${finance.accessToken}`, 'x-tenant-id': acmeId },
      payload: {
        categorySlug: 'headphones',
        slug: 'finance-cans',
        name: 'Finance Cans',
        variants: [{ sku: 'FIN-CANS-1', name: 'Default' }],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses the admin product queue to a non-admin', async () => {
    const seller = await login('karim@acme.test');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/products',
      headers: { authorization: `Bearer ${seller.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses an attribute carrying two values', async () => {
    const seller = await login('karim@acme.test');
    const orgs = await app.inject({
      method: 'GET',
      url: '/orgs/mine',
      headers: { authorization: `Bearer ${seller.accessToken}` },
    });
    const acmeId =
      orgs.json<{ items: { id: string; slug: string }[] }>().items.find((o) => o.slug === 'acme-electronics')
        ?.id ?? '';

    const res = await app.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${seller.accessToken}`, 'x-tenant-id': acmeId },
      payload: {
        categorySlug: 'headphones',
        slug: 'ambiguous-cans',
        name: 'Ambiguous Cans',
        variants: [{ sku: 'AMB-CANS-1', name: 'Default' }],
        attributes: [{ key: 'form_factor', text: 'In-ear', bool: true }],
      },
    });
    // A 400 that names the key, rather than a 500 from the CHECK constraint.
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/form_factor/);
  });
});
