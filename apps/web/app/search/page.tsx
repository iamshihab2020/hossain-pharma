import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { SortKey } from '@nexmarket/api-client';
import { search } from '@/lib/api/queries';
import { ProductCard } from '@/components/product-card';
import { SearchSort } from '@/components/search-sort';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { plural } from '@/lib/format';

export const metadata: Metadata = { title: 'Search' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Search results.
 *
 * Filters are URL state, not component state, and that is the whole design:
 * a filtered result is a link a buyer can send to someone, reload, and reach
 * with the back button. Client-side filtering would trade all three for one
 * saved round trip.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<ReactNode> {
  const params = await searchParams;
  const q = single(params['q']);
  const category = single(params['category']);
  const brand = single(params['brand']);
  const cursor = single(params['cursor']);
  const inStock = single(params['inStock']) === 'true';
  const sort = asSort(single(params['sort']));

  const results = await search({
    ...(q === undefined ? {} : { q }),
    ...(category === undefined ? {} : { category }),
    ...(brand === undefined ? {} : { brand }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(sort === undefined ? {} : { sort }),
    inStock,
  });

  const heading = q === undefined ? 'All products' : `Results for “${q}”`;
  const activeFilters = [category, brand].filter((value) => value !== undefined).length + (inStock ? 1 : 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
          <p className="mt-1 text-sm text-muted-foreground tabular">
            {plural(results.total, 'product', 'products')}
          </p>
        </div>
        <SearchSort current={sort ?? 'relevance'} />
      </header>

      <Separator className="my-6" />

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Filters
            {activeFilters > 0 && <Badge variant="secondary">{activeFilters}</Badge>}
          </div>

          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
              <Link href={q === undefined ? '/search' : `/search?q=${encodeURIComponent(q)}`}>
                Clear filters
              </Link>
            </Button>
          )}

          <Accordion type="multiple" defaultValue={['category', 'brand', 'availability']}>
            <FacetGroup
              id="category"
              label="Category"
              param="category"
              active={category}
              values={results.facets.category}
              params={params}
            />
            <FacetGroup
              id="brand"
              label="Brand"
              param="brand"
              active={brand}
              values={results.facets.brand}
              params={params}
            />
            <AccordionItem value="availability">
              <AccordionTrigger>Availability</AccordionTrigger>
              <AccordionContent>
                <Link
                  href={toggleParam(params, 'inStock', inStock ? undefined : 'true')}
                  className={`block rounded-md px-2 py-1.5 text-sm hover:bg-accent ${
                    inStock ? 'font-medium text-primary' : 'text-muted-foreground'
                  }`}
                >
                  In stock only
                </Link>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </aside>

        <section>
          {results.items.length === 0 ? (
            <EmptyState
              title="No products match"
              description={
                q === undefined
                  ? 'Try removing a filter.'
                  : `Nothing matched “${q}”. Try fewer words, or check the spelling.`
              }
            />
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {results.items.map((hit) => (
                  <li key={hit.productId}>
                    <ProductCard
                      slug={hit.slug}
                      name={hit.name}
                      brand={hit.brand}
                      fromPrice={hit.price}
                      sellerCount={hit.sellerCount}
                      inStock={hit.inStock}
                    />
                  </li>
                ))}
              </ul>

              {/*
                A link, not an infinite scroll. Pagination is CURSOR based
                (PRD 13), so this carries the opaque cursor forward; an offset
                would drift the moment a seller published something. Infinite
                scroll is where a client data library would earn its place, and
                it is deliberately not half-built here.
              */}
              {results.nextCursor !== null && (
                <div className="mt-8 flex justify-center">
                  <Button variant="outline" asChild>
                    <Link href={toggleParam(params, 'cursor', results.nextCursor)}>
                      Next page
                    </Link>
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function FacetGroup({
  id,
  label,
  param,
  active,
  values,
  params,
}: {
  id: string;
  label: string;
  param: string;
  active: string | undefined;
  values: { value: string; label: string; count: number }[];
  params: Record<string, string | string[] | undefined>;
}): ReactNode {
  if (values.length === 0) return null;

  return (
    <AccordionItem value={id}>
      <AccordionTrigger>{label}</AccordionTrigger>
      <AccordionContent>
        <ul className="flex flex-col">
          {values.map((facet) => {
            const selected = facet.value === active;
            return (
              <li key={facet.value}>
                <Link
                  href={toggleParam(params, param, selected ? undefined : facet.value)}
                  className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent ${
                    selected ? 'font-medium text-primary' : 'text-muted-foreground'
                  }`}
                >
                  <span className="truncate">{facet.label}</span>
                  <span className="shrink-0 text-xs tabular">{facet.count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </AccordionContent>
    </AccordionItem>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value === '' ? undefined : value;
}

function asSort(value: string | undefined): SortKey | undefined {
  const allowed: SortKey[] = ['relevance', 'price_asc', 'price_desc', 'newest', 'sellers'];
  return allowed.find((key) => key === value);
}

/**
 * Rebuilds the query string with one parameter changed.
 *
 * Always drops `cursor`: changing a filter has to start from the first page, or
 * the buyer lands mid-way through a result set they have never seen the start
 * of.
 */
function toggleParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
  value: string | undefined,
): string {
  const next = new URLSearchParams();
  for (const [name, raw] of Object.entries(params)) {
    const first = single(raw);
    if (first === undefined || name === key || name === 'cursor') continue;
    next.set(name, first);
  }
  if (value !== undefined) next.set(key, value);
  const rendered = next.toString();
  return rendered === '' ? '/search' : `/search?${rendered}`;
}
