'use client';

import { Package } from 'lucide-react';
import { SortDropdown, SortOption } from './sort-dropdown';

interface ShopHeaderProps {
  title?: string;
  productCount: number;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
}

export function ShopHeader({
  title = 'All Products',
  productCount,
  sortBy,
  onSortChange,
}: ShopHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          {title}
        </h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Package className="h-4 w-4" />
          {productCount} {productCount === 1 ? 'product' : 'products'} found
        </p>
      </div>

      <SortDropdown value={sortBy} onChange={onSortChange} />
    </div>
  );
}
