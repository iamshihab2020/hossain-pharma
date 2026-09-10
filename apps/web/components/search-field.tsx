'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

/**
 * A plain form that navigates, not a live-filtering box.
 *
 * Navigation is the right primitive here: the result is a URL a buyer can
 * share, reload and reach with the back button, and the results page is server
 * rendered so it is crawlable. A client-side filter would give up all three to
 * save one round trip.
 *
 * Typeahead suggestions are the one part of search that genuinely wants a
 * client cache - `/search/suggest` exists for it - and that is where a data
 * library earns its place. Deliberately not built yet rather than half-built.
 */
export function SearchField({ autoFocus = false }: { autoFocus?: boolean }): ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = term.trim();
    router.push(trimmed === '' ? '/search' : `/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={submit} role="search">
      <label htmlFor="site-search" className="sr-only">
        Search products
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="site-search"
          name="q"
          type="search"
          autoFocus={autoFocus}
          value={term}
          onChange={(event) => { setTerm(event.target.value); }}
          placeholder="Search products"
          className="pl-9"
          // enterKeyHint changes the on-screen keyboard's action key on the
          // phones most of this audience uses. Cheap, and it is the difference
          // between "Go" and a newline that does nothing.
          enterKeyHint="search"
        />
      </div>
    </form>
  );
}
