import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Deliberately quiet. A marketplace footer is where trust signals live, not
 * where a second navigation goes - the header already carries search.
 */
export function SiteFooter(): ReactNode {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          Every offer on a product page is ranked by delivered price. We never
          reorder them for payment.
        </p>
        <nav className="flex gap-4">
          <Link href="/search" className="hover:text-foreground">
            Browse
          </Link>
          <Link href="/orders" className="hover:text-foreground">
            Orders
          </Link>
        </nav>
      </div>
    </footer>
  );
}
