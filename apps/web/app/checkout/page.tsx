import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getAddresses, getCart, getDeliverySlots, getQuote } from '@/lib/api/queries';
import { isSignedIn } from '@/lib/api/server';
import { AddressForm } from '@/components/address-form';
import { CheckoutPanel } from '@/components/checkout-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoney } from '@/lib/format';
import { marketToday } from '@/lib/delivery';

export const metadata: Metadata = { title: 'Checkout' };

/**
 * Checkout.
 *
 * Authenticated, unlike the cart: a guest may fill a basket - that is the whole
 * point of the guest cart - but placing an order creates a payment obligation
 * and a seller-visible record with a delivery address on it.
 *
 * The quote is computed by the server from `listings` inside its own
 * transaction and recomputed again at confirm. Nothing on this page becomes
 * money; the total shown here is only ever COMPARED against the recomputed one.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  if (!(await isSignedIn())) redirect('/signin?next=/checkout');

  const params = await searchParams;
  const requested = typeof params['address'] === 'string' ? params['address'] : undefined;

  const [cart, addresses] = await Promise.all([getCart(), getAddresses()]);

  if (cart.itemCount === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <EmptyState
          title="Your cart is empty"
          description="Add something before checking out."
        />
        <div className="flex justify-center">
          <Button asChild>
            <Link href="/">Browse products</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (addresses.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Where should it go?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We need an address before we can quote delivery.
        </p>
        <Card className="mt-6">
          <CardContent className="pt-6">
            <AddressForm />
          </CardContent>
        </Card>
      </div>
    );
  }

  // The default shipping address is preselected. Asking a question with one
  // sensible answer is a step, not a choice.
  const selected =
    addresses.find((address) => address.id === requested) ??
    addresses.find((address) => address.isDefaultShipping) ??
    addresses[0];

  if (selected === undefined) redirect('/cart');

  const quote = await getQuote(selected.id);

  /**
   * Windows for the ADDRESS, fetched after the quote because the quote is what
   * proved the address resolves to a zone at all.
   *
   * `marketToday` rather than `new Date()`: the picker labels a column "Today",
   * and which day that is depends on where the courier is, not where the server
   * is. Resolved once here so the server and the hydrated client cannot
   * disagree across midnight.
   */
  const slots = await getDeliverySlots(selected.postcode, selected.countryCode);
  const today = marketToday().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-base">Delivery address</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul className="flex flex-col gap-2">
                {addresses.map((address) => {
                  const active = address.id === selected.id;
                  return (
                    <li key={address.id}>
                      <Link
                        href={`/checkout?address=${address.id}`}
                        className={`block rounded-lg border p-3 text-sm transition-colors ${
                          active
                            ? 'border-primary bg-wash'
                            : 'border-border hover:border-line-strong'
                        }`}
                      >
                        <span className="font-medium">{address.recipientName}</span>
                        <span className="mt-0.5 block text-muted-foreground">
                          {address.line1}
                          {address.line2 === null ? '' : `, ${address.line2}`}, {address.city},{' '}
                          {address.district} {address.postcode}
                        </span>
                        <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                          {address.phone}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-base">
                {quote.groups.length === 1
                  ? 'Your order'
                  : `${String(quote.groups.length)} orders, one payment`}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {quote.groups.length > 1 && (
                <p className="text-sm text-muted-foreground">
                  Each seller ships separately, so items arrive on different days.
                </p>
              )}
              {quote.groups.map((group) => (
                <div key={group.sellerId} className="flex flex-col gap-2">
                  <p className="text-sm font-semibold">{group.sellerName}</p>
                  <ul className="flex flex-col gap-1 text-sm">
                    {group.lines.map((line) => (
                      <li key={line.listingId} className="flex justify-between gap-4">
                        <span className="min-w-0 truncate text-muted-foreground">
                          {line.quantity} × {line.productName}
                        </span>
                        <span className="shrink-0 tabular">{formatMoney(line.lineTotal)}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-4 text-muted-foreground">
                      <span>Delivery</span>
                      <span className="tabular">{formatMoney(group.shipping)}</span>
                    </li>
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <CheckoutPanel addressId={selected.id} quote={quote} slots={slots} today={today} />
        </aside>
      </div>
    </div>
  );
}
