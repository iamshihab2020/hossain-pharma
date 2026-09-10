import Link from 'next/link';
import type { ReactNode } from 'react';
import { ShoppingCart, User } from 'lucide-react';
import { getCart } from '@/lib/api/queries';
import { isSignedIn } from '@/lib/api/server';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchField } from '@/components/search-field';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * The header reads the cart on the server, so the item count is correct in the
 * first paint rather than appearing a moment later.
 *
 * That is a deliberate trade: it makes the header dynamic, so pages carrying it
 * are not statically prerendered. For a marketplace where the cart badge being
 * wrong is a support ticket, it is the right side of the trade - and the
 * catalogue data underneath is still served from the cache.
 */
export async function SiteHeader(): Promise<ReactNode> {
  const [cart, signedIn] = await Promise.all([safeCart(), isSignedIn()]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-4">
        <Link
          href="/"
          className="shrink-0 text-lg font-bold tracking-tight"
          aria-label="NexMarket home"
        >
          nex<span className="text-primary">market</span>
        </Link>

        <div className="min-w-0 flex-1">
          <SearchField />
        </div>

        <nav className="flex shrink-0 items-center gap-1">
          <ThemeToggle />

          <Button variant="ghost" size="icon" asChild aria-label={signedIn ? 'Your account' : 'Sign in'}>
            <Link href={signedIn ? '/orders' : '/signin'}>
              <User className="h-4 w-4" />
            </Link>
          </Button>

          <Button variant="ghost" size="icon" asChild className="relative" aria-label={cartLabel(cart.itemCount)}>
            <Link href="/cart">
              <ShoppingCart className="h-4 w-4" />
              {cart.itemCount > 0 && (
                <Badge
                  className="absolute -right-1 -top-1 h-5 min-w-5 justify-center px-1 tabular"
                  aria-hidden="true"
                >
                  {cart.itemCount}
                </Badge>
              )}
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}

function cartLabel(count: number): string {
  if (count === 0) return 'Cart, empty';
  return `Cart, ${String(count)} ${count === 1 ? 'item' : 'items'}`;
}

/**
 * The header must never be the thing that breaks the page.
 *
 * A cart read can fail for reasons that have nothing to do with the page being
 * viewed - an expired session, the API restarting in development. Rendering the
 * catalogue with an empty badge is a far better answer than a 500 on a product
 * page that needed no session at all.
 */
async function safeCart(): Promise<{ itemCount: number }> {
  try {
    return await getCart();
  } catch {
    return { itemCount: 0 };
  }
}
