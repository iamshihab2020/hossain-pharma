'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import type { SortKey } from '@nexmarket/api-client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'relevance', label: 'Most relevant' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'sellers', label: 'Most sellers' },
  { value: 'newest', label: 'Newest' },
];

/**
 * Sorting navigates rather than re-filtering in place, so the choice is part of
 * the shareable URL like every other filter.
 *
 * "Most sellers" is here because it is this marketplace's own axis - no other
 * storefront can offer it, and it is backed by a real ORDER BY on the
 * materialised `seller_count` rather than a client-side sort of one page.
 */
export function SearchSort({ current }: { current: SortKey }): ReactNode {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function choose(value: string): void {
    const next = new URLSearchParams(params.toString());
    if (value === 'relevance') next.delete('sort');
    else next.set('sort', value);
    // A new sort is a new result set, so paging has to start over.
    next.delete('cursor');
    const query = next.toString();
    router.push(query === '' ? pathname : `${pathname}?${query}`);
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sort" className="text-sm text-muted-foreground">
        Sort
      </label>
      <Select value={current} onValueChange={choose}>
        <SelectTrigger id="sort" className="w-[190px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
