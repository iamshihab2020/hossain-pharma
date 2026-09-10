import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatMoney, plural } from '@/lib/format';
import type { Money } from '@nexmarket/api-client';

export type ProductCardProps = {
  slug: string;
  name: string;
  brand: string | null;
  fromPrice: Money | null;
  sellerCount: number;
  inStock?: boolean;
};

/**
 * One product, not one offer. A grid that repeated the same handset once per
 * seller is the failure the shared catalogue exists to avoid.
 *
 * The seller count is the marketplace-native fact worth surfacing here: it is
 * the reason to open this card rather than the one next to it.
 */
export function ProductCard({
  slug,
  name,
  brand,
  fromPrice,
  sellerCount,
  inStock = true,
}: ProductCardProps): ReactNode {
  return (
    <Card className="group h-full overflow-hidden transition-colors hover:border-line-strong">
      <Link href={`/p/${slug}`} className="block h-full">
        <ProductThumb name={name} />
        <CardContent className="flex flex-col gap-1 p-3">
          {brand !== null && (
            <span className="text-xs text-muted-foreground">{brand}</span>
          )}
          <h3 className="line-clamp-2 text-sm font-medium leading-snug">{name}</h3>

          <div className="mt-1 flex items-baseline gap-2">
            {fromPrice === null ? (
              <span className="text-sm text-muted-foreground">Not currently sold</span>
            ) : (
              <span className="font-semibold tabular">{formatMoney(fromPrice)}</span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            {sellerCount > 1 ? (
              <Badge variant="secondary" className="font-normal">
                {plural(sellerCount, 'seller', 'sellers')}
              </Badge>
            ) : null}
            {!inStock && (
              <Badge variant="outline" className="border-warn/40 bg-warn-wash font-normal text-warn">
                Out of stock
              </Badge>
            )}
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}

/**
 * A placeholder, and honestly labelled as one.
 *
 * `product_media` exists in the schema and nothing has uploaded to it yet, so
 * there is no image to show. A grey box with the product's initial is better
 * than a broken image icon and better than a stock photo of something that is
 * not the product. The `product-image` class carries the dark-mode brightness
 * rule for when real photography arrives.
 */
function ProductThumb({ name }: { name: string }): ReactNode {
  return (
    <div className="product-image flex aspect-square items-center justify-center border-b border-border bg-sunk">
      <span
        className="select-none text-4xl font-semibold text-muted-foreground/40"
        aria-hidden="true"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    </div>
  );
}
