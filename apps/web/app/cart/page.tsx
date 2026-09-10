import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Store } from 'lucide-react';
import { getCart } from '@/lib/api/queries';
import { isSignedIn } from '@/lib/api/server';
import { CartLineRow } from '@/components/cart-line-row';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { formatMoney, plural } from '@/lib/format';

export const metadata: Metadata = { title: 'Cart' };

/**
 * The cart, grouped by seller.
 *
 * The grouping is not presentation - it is what actually happens. A cart
 * spanning three sellers becomes three orders under one payment, and telling
 * the buyer that here is better than surprising them with three delivery dates
 * afterwards.
 *
 * Every amount on this page comes from `listings` on the way out. `cart_items`
 * has no money column at all, which is what makes price tampering
 * unrepresentable rather than merely rejected.
 */
export default async function CartPage(): Promise<ReactNode> {
  const [cart, signedIn] = await Promise.all([getCart(), isSignedIn()]);

  if (cart.itemCount === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <EmptyState
          icon={Store}
          title="Nothing here yet"
          description="Search for something, or start from the home page."
        />
        <div className="flex justify-center">
          <Button asChild>
            <Link href="/">Browse products</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Your cart</h1>
        <p className="mt-1 text-sm text-muted-foreground tabular">
          {plural(cart.itemCount, 'item', 'items')} from{' '}
          {plural(cart.groups.length, 'seller', 'sellers')}
        </p>
      </header>

      {cart.hasUnavailableLines && (
        <Alert className="mb-6 border-warn/40 bg-warn-wash">
          <AlertDescription className="text-warn">
            Some items are no longer available. Remove them to continue to
            checkout.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          {cart.groups.map((group) => (
            <Card key={group.sellerId}>
              <CardHeader className="flex-row items-center justify-between gap-4 space-y-0 border-b border-border py-4">
                <CardTitle className="text-base font-semibold">
                  {group.sellerName}
                </CardTitle>
                <span className="text-sm text-muted-foreground tabular">
                  {formatMoney(group.subtotal)}
                </span>
              </CardHeader>
              <CardContent className="p-0">
                <ul>
                  {group.lines.map((line, index) => (
                    <li
                      key={line.id}
                      className={index > 0 ? 'border-t border-border' : undefined}
                    >
                      <CartLineRow line={line} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium tabular">{formatMoney(cart.subtotal)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Delivery and VAT are calculated once you choose an address.
              </p>

              <Separator />

              {/*
                One payment, several orders. Saying so here rather than after
                the fact is the difference between a feature and a surprise.
              */}
              {cart.groups.length > 1 && (
                <p className="text-sm text-muted-foreground">
                  You pay once. Each seller ships separately, so items arrive on
                  different days.
                </p>
              )}

              <Button asChild size="lg" disabled={cart.hasUnavailableLines}>
                <Link href={signedIn ? '/checkout' : '/signin?next=/checkout'}>
                  {signedIn ? 'Continue to checkout' : 'Sign in to check out'}
                </Link>
              </Button>

              {!signedIn && (
                <p className="text-xs text-muted-foreground">
                  Your cart is kept when you sign in.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
