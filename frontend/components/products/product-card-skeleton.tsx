'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';

interface ProductCardSkeletonProps {
  className?: string;
}

export function ProductCardSkeleton({ className }: ProductCardSkeletonProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      {/* Image skeleton */}
      <Skeleton className="aspect-square w-full" />

      <CardContent className="p-4">
        {/* Category */}
        <Skeleton className="h-3 w-16 mb-2" />

        {/* Name */}
        <Skeleton className="h-5 w-full mb-1" />
        <Skeleton className="h-5 w-3/4 mb-2" />

        {/* Manufacturer */}
        <Skeleton className="h-3 w-24 mb-3" />

        {/* Price */}
        <Skeleton className="h-6 w-20 mb-3" />

        {/* Button */}
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}

// Grid of skeleton cards
interface ProductGridSkeletonProps {
  count?: number;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}

const gridClasses = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
};

export function ProductGridSkeleton({
  count = 8,
  columns = 4,
  className,
}: ProductGridSkeletonProps) {
  return (
    <div className={cn('grid gap-4 md:gap-6', gridClasses[columns], className)}>
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
