import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api/server';
import { getProduct, getProductRating, getProductReviews, getSimilar } from '@/lib/api/queries';
import { DeliveryCheck } from '@/components/delivery-check';
import { OfferTable } from '@/components/offer-table';
import { ProductCard } from '@/components/product-card';
import { ReviewPanel } from '@/components/review-panel';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

/**
 * The product page: one product, every seller's offer on it.
 *
 * Server rendered, deliberately. A marketplace lives on these pages being
 * indexed, and the comparison is in the first response rather than after a
 * bundle and a fetch - which on a mid-range Android over 4G is the difference
 * between a usable page and a spinner.
 */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  try {
    const product = await getProduct(slug);
    const sellers = product.variants[0]?.buyBox.offers.length ?? 0;
    return {
      title: product.name,
      description:
        product.description ??
        `Compare ${String(sellers)} sellers on ${product.name} by delivered price.`,
    };
  } catch {
    return { title: 'Product' };
  }
}

export default async function ProductDetailPage({ params }: Params): Promise<ReactNode> {
  const { slug } = await params;

  let product;
  try {
    product = await getProduct(slug);
  } catch (error) {
    // A 404 from the API is a 404 here. Anything else is a real failure and
    // should reach the error boundary rather than be disguised as "not found".
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  /**
   * In PARALLEL, because none of the three needs the others.
   *
   * Sequential awaits here would add a round trip each to a page whose whole
   * argument for being server-rendered is that the comparison arrives in the
   * first response. Each falls back rather than throwing: a rating service
   * having a bad minute must not take a product page down with it, which is the
   * same call the delivery check and the return-pickup panel already make.
   */
  const [similar, rating, reviews] = await Promise.all([
    getSimilar(slug).catch(() => []),
    getProductRating(product.id).catch(() => ({
      average: null,
      total: 0,
      distribution: [],
    })),
    getProductReviews(product.id).catch(() => []),
  ]);
  const [primary] = product.variants;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <nav className="mb-4 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href={`/c/${product.category.slug}`} className="hover:text-foreground">
          {product.category.name}
        </Link>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div>
          <div className="product-image flex aspect-square items-center justify-center rounded-tile border border-border bg-sunk">
            <span
              className="select-none text-7xl font-semibold text-muted-foreground/40"
              aria-hidden="true"
            >
              {product.name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            {product.brand !== null && (
              <span className="text-sm text-muted-foreground">{product.brand}</span>
            )}
            <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {product.name}
            </h1>
            {product.category.isRestricted && (
              <Badge
                variant="outline"
                className="w-fit border-warn/40 bg-warn-wash font-normal text-warn"
              >
                Age-restricted · we will ask your date of birth at checkout
              </Badge>
            )}
          </header>

          {product.variants.length > 1 ? (
            <Tabs defaultValue={primary?.id ?? ''}>
              <TabsList className="flex h-auto w-full flex-wrap justify-start">
                {product.variants.map((variant) => (
                  <TabsTrigger key={variant.id} value={variant.id}>
                    {variant.name}
                  </TabsTrigger>
                ))}
              </TabsList>
              {product.variants.map((variant) => (
                <TabsContent key={variant.id} value={variant.id} className="mt-6">
                  {/* ABOVE the comparison, because the answer changes which
                      offer wins: delivery is part of landed price, and a buyer
                      who scrolls past three sellers before learning we do not
                      come to their street has been shown a table for nothing.
                      Per variant, since the box and its weight are the
                      variant's. */}
                  <DeliveryCheck
                    chargeableGrams={variant.chargeableGrams}
                    dispatchDays={variant.buyBox.winner?.dispatchDays ?? 1}
                  />
                  <OfferTable buyBox={variant.buyBox} productName={product.name} />
                </TabsContent>
              ))}
            </Tabs>
          ) : primary === undefined ? (
            <p className="text-sm text-muted-foreground">
              This product has no variants to sell yet.
            </p>
          ) : (
            <>
              <DeliveryCheck
                chargeableGrams={primary.chargeableGrams}
                dispatchDays={primary.buyBox.winner?.dispatchDays ?? 1}
              />
              <OfferTable buyBox={primary.buyBox} productName={product.name} />
            </>
          )}
        </div>
      </div>

      {(product.description !== null || product.attributes.length > 0) && (
        <>
          <Separator className="my-10" />
          <section className="grid gap-8 lg:grid-cols-2">
            {product.description !== null && (
              <div>
                <h2 className="text-lg font-semibold">About this product</h2>
                <p className="mt-3 max-w-[62ch] leading-relaxed text-muted-foreground">
                  {product.description}
                </p>
              </div>
            )}

            {product.attributes.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold">Specifications</h2>
                <div className="mt-3 overflow-hidden rounded-lg border border-border">
                  <Table>
                    <TableBody>
                      {product.attributes.map((attribute) => (
                        <TableRow key={attribute.key}>
                          <TableCell className="w-1/2 text-muted-foreground">
                            {attribute.label}
                          </TableCell>
                          <TableCell className="font-medium">
                            {formatAttribute(attribute.value)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {/* BELOW the offers and below the specifications. The question this page
          exists to answer is which seller to buy from, and the comparison table
          answers it; reviews are the evidence somebody consults after the
          shortlist, not before it. */}
      <ReviewPanel summary={rating} reviews={reviews} />

      {similar.length > 0 && (
        <>
          <Separator className="my-10" />
          <section>
            <h2 className="text-lg font-semibold">Similar products</h2>
            <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {similar.map((hit) => (
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
          </section>
        </>
      )}
    </div>
  );
}

function formatAttribute(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
