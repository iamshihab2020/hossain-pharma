import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { endpoints, type StorefrontOffer } from '@nexmarket/api-client';
import { ApiError, apiGet } from '@/lib/api/server';
import { RatingStars } from '@/components/rating-stars';
import { formatMoney, plural } from '@/lib/format';
import { reviewCountLabel, scaledBars } from '@/lib/reviews';

/**
 * A seller's own page. PRD 9.5.
 *
 * `/s/[slug]`, deliberately short: it is a link printed beside every offer on
 * every product page, so it is one people see constantly and occasionally type.
 * `/p/` for products already set the precedent.
 *
 * PUBLIC, and that is the fourth thing the Phase 7 ownership decision buys. A
 * storefront is where a shopper arrives from a product page to decide whether
 * they trust a seller, and that decision is made before signing in or not at
 * all - so `seller_ratings` has to be readable by somebody who belongs to no
 * organisation.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const store = await apiGet(endpoints.storefront(slug), { auth: false, revalidate: 60 });
    return {
      title: store.displayName,
      description: `${store.displayName} on NexMarket — ${reviewCountLabel(store.rating.total)}.`,
    };
  } catch {
    return { title: 'Seller' };
  }
}

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<ReactNode> {
  const { slug } = await params;

  let store;
  try {
    store = await apiGet(endpoints.storefront(slug), {
      auth: false,
      revalidate: 60,
      tags: ['catalogue', `seller:${slug}`],
    });
  } catch (error) {
    // A suspended seller is a 404 from the API, not a page explaining itself -
    // a suspension is an enforcement action, not a status page for the public.
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="flex flex-col gap-3 border-b pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{store.displayName}</h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {/* The component prints the figure itself. A second visible copy
              beside it read out twice in a row to a screen reader, which is
              what a duplicated sr-only label always costs. */}
          <RatingStars average={store.rating.average} size="lg" />
          <span>·</span>
          <span>{reviewCountLabel(store.rating.total)}</span>
          <span>·</span>
          <span>{plural(store.listingCount, 'product', 'products')}</span>
          <span>·</span>
          <span>Selling since {new Date(store.memberSince).getFullYear()}</span>
        </div>
      </header>

      {store.rating.total > 0 && (
        <section className="mt-8 max-w-sm">
          <h2 className="text-base font-semibold">How buyers rate them</h2>
          <div className="mt-3">
            {scaledBars(store.rating).map((bar) => (
              <div key={bar.stars} className="flex items-center gap-3 py-0.5 text-xs">
                <span className="w-10 shrink-0 tabular text-muted-foreground">
                  {bar.stars} star
                </span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-sunk">
                  <span
                    className="block h-full rounded-full bg-foreground/70"
                    style={{ width: `${String(bar.width)}%` }}
                  />
                </span>
                <span className="w-9 shrink-0 text-right tabular text-muted-foreground">
                  {bar.share}%
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 max-w-prose text-xs text-muted-foreground">
            {/* Said plainly, because it is not the obvious reading. One review
                counts against the product AND the seller who fulfilled it -
                there is no separate "rate the seller" step buyers would
                reliably complete on a marketplace where several sellers share
                one product page. */}
            Ratings come from reviews of orders this seller actually delivered.
          </p>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-base font-semibold">What they sell</h2>
        {store.offers.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing listed right now.</p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {store.offers.map((offer) => (
              <li key={offer.listingId}>
                <Offer offer={offer} />
              </li>
            ))}
          </ul>
        )}

        {store.listingCount > store.offers.length && (
          /* The storefront is a shop window; the catalogue proper is search,
             which already has paging, facets and sorting. A second paging
             implementation here would be a second thing to get wrong. */
          <p className="mt-6 text-sm">
            <Link
              href={`/search?q=${encodeURIComponent(store.displayName)}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              See all {store.listingCount} products
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}

function Offer({ offer }: { offer: StorefrontOffer }): ReactNode {
  return (
    <Link
      href={`/p/${offer.productSlug}`}
      className="flex h-full flex-col gap-1 rounded-tile border border-border p-4 transition-colors hover:bg-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="text-sm font-medium">{offer.productName}</p>
      <p className="text-xs text-muted-foreground">{offer.variantName}</p>
      <p className="mt-auto pt-2 font-semibold tabular">{formatMoney(offer.price)}</p>
      {offer.availableStock === 0 && <p className="text-xs text-warn">Out of stock</p>}
    </Link>
  );
}
