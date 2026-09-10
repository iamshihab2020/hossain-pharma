import Link from 'next/link';
import type { ReactNode } from 'react';
import { getCategories, getMostCompeted } from '@/lib/api/queries';
import { ProductCard } from '@/components/product-card';
import { SearchField } from '@/components/search-field';
import { Separator } from '@/components/ui/separator';

/**
 * The home page.
 *
 * No carousel, no countdown, no flash-sale rail. Those are the category
 * default and this storefront's position is that a marketplace which visibly
 * refuses to manufacture urgency is worth more than a countdown - see
 * docs/DESIGN-DIRECTION.md.
 *
 * What replaces them: search as a typographic object, the taxonomy as a
 * readable list rather than an icon grid, and exactly ONE rail with a reason to
 * exist.
 */
export default async function HomePage(): Promise<ReactNode> {
  const [categories, competed] = await Promise.all([getCategories(), getMostCompeted()]);

  const topLevel = categories.filter((node) => !node.path.includes('.'));
  const browsable = topLevel.length > 0 ? topLevel : categories;

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-12 sm:py-16">
        <h1 className="max-w-[14ch] text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
          Compare every seller.
        </h1>
        <p className="mt-4 max-w-[52ch] text-base text-muted-foreground sm:text-lg">
          One product page, every offer on it, ranked by what you actually pay
          once delivery is added.
        </p>

        <div className="mt-8 max-w-xl">
          <SearchField />
        </div>

        <nav className="mt-6 flex flex-wrap gap-x-5 gap-y-2" aria-label="Browse categories">
          {browsable.map((category) => (
            <Link
              key={category.id}
              href={`/c/${category.slug}`}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {category.name}
            </Link>
          ))}
        </nav>
      </section>

      <Separator />

      <section className="py-10">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Where sellers compete</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Products with the most offers today.
            </p>
          </div>
          <Link
            href="/search?sort=sellers&inStock=true"
            className="shrink-0 text-sm text-primary underline-offset-4 hover:underline"
          >
            See all
          </Link>
        </div>

        {competed.items.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            Nothing is listed yet. Run <code className="font-mono">pnpm seed</code> to
            populate the demo market.
          </p>
        ) : (
          <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {competed.items.map((hit) => (
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
        )}
      </section>
    </div>
  );
}
