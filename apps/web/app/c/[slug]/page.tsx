import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api/server';
import { getCategories, getCategoryProducts } from '@/lib/api/queries';
import { ProductCard } from '@/components/product-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { plural } from '@/lib/format';
import type { CategoryNode } from '@nexmarket/api-client';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const node = findNode(await getCategories().catch(() => []), slug);
  return { title: node?.name ?? 'Category' };
}

/**
 * Category browsing.
 *
 * The catalogue endpoint returns the whole category rather than a page of it -
 * that is the API's shape today, and pretending otherwise with a fake paginator
 * would be worse than showing what there is. Search is the paginated surface,
 * and the link to it is right here for when a category outgrows one screen.
 */
export default async function CategoryPage({ params }: Params): Promise<ReactNode> {
  const { slug } = await params;

  let products;
  try {
    products = await getCategoryProducts(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const categories = await getCategories().catch(() => []);
  const node = findNode(categories, slug);
  const children = node?.children ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{node?.name ?? slug}</h1>
        <p className="mt-1 text-sm text-muted-foreground tabular">
          {plural(products.length, 'product', 'products')}
        </p>
      </header>

      {children.length > 0 && (
        <nav className="mt-4 flex flex-wrap gap-x-5 gap-y-2" aria-label="Subcategories">
          {children.map((child) => (
            <Link
              key={child.id}
              href={`/c/${child.slug}`}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {child.name}
            </Link>
          ))}
        </nav>
      )}

      <Separator className="my-6" />

      {products.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="No seller has listed a product in this category. Try searching instead."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <li key={product.id}>
              <ProductCard
                slug={product.slug}
                name={product.name}
                brand={product.brand}
                fromPrice={product.fromPrice}
                sellerCount={product.sellerCount}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The tree arrives nested, so finding one node means walking it. */
function findNode(nodes: CategoryNode[], slug: string): CategoryNode | undefined {
  for (const node of nodes) {
    if (node.slug === slug) return node;
    const found = findNode(node.children, slug);
    if (found !== undefined) return found;
  }
  return undefined;
}
