'use client';

import { cn } from '@/lib/utils';
import { BackendProduct } from '@/types/api';
import { ProductCard } from './product-card';
import { NoProductsState } from '@/components/ui/empty-state';
import { ProductCardSkeleton } from './product-card-skeleton';

interface ProductGridProps {
  products: BackendProduct[];
  isLoading?: boolean;
  skeletonCount?: number;
  className?: string;
  columns?: 2 | 3 | 4 | 5;
  onProductClick?: (product: BackendProduct) => void;
  emptyStateAction?: () => void;
}

const gridClasses = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
};

export function ProductGrid({
  products,
  isLoading = false,
  skeletonCount = 8,
  className,
  columns = 4,
  onProductClick,
  emptyStateAction,
}: ProductGridProps) {
  if (isLoading) {
    return (
      <div className={cn('grid gap-4 md:gap-6', gridClasses[columns], className)}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return <NoProductsState onAction={emptyStateAction} />;
  }

  return (
    <div className={cn('grid gap-4 md:gap-6', gridClasses[columns], className)}>
      {products.map((product) => (
        <ProductCard
          key={product._id}
          product={product}
          onClick={() => onProductClick?.(product)}
        />
      ))}
    </div>
  );
}
