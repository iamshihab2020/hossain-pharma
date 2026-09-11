import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { endpoints, type ReviewablePurchase } from '@nexmarket/api-client';
import { apiGet, isSignedIn } from '@/lib/api/server';
import { ReviewForm } from '@/components/review-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle2 } from 'lucide-react';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Reviews to write' };

/**
 * Everything this buyer has received and not yet reviewed.
 *
 * A PAGE OF ITS OWN rather than a prompt buried on each order, because the
 * question "what have I not got round to reviewing?" has one answer and it
 * spans every order. The API answers exactly that question - delivered, mine,
 * not already done - so the page has no filtering of its own to get wrong, and
 * a line it offers is a line the server will accept.
 *
 * Server component: the list is a read, and the only interactive part is the
 * form, which is its own client island.
 */
export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  if (!(await isSignedIn())) redirect('/signin?next=/reviews');

  const params = await searchParams;
  const posted = params['posted'] !== undefined;

  const { items } = await apiGet(endpoints.reviewablePurchases(), { auth: true });

  return (
    <div className="mx-auto w-full max-w-3xl py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Reviews to write</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Only things that have actually arrived can be reviewed, and each purchase gets one
        review. That is what the verified badge on the product page means.
      </p>

      {posted && (
        /* The confirmation arrives in the URL rather than in the form's own
           state, because a Server Action refreshes the route it was called
           from and takes the form with it. Checkout does the same thing with
           `/orders?placed=`. */
        <Alert className="mt-6 border-primary/40 bg-wash">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <AlertTitle>Review posted</AlertTitle>
          <AlertDescription>
            It is on the product page now, with your name and the seller you bought from.
          </AlertDescription>
        </Alert>
      )}

      {items.length === 0 ? (
        <p className="mt-10 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Nothing waiting. Once an order is delivered it appears here.{' '}
          <Link href="/orders" className="text-primary underline-offset-4 hover:underline">
            Your orders
          </Link>
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-10">
          {items.map((purchase) => (
            <li key={purchase.orderItemId} className="border-t pt-6 first:border-t-0 first:pt-0">
              <Pending purchase={purchase} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Pending({ purchase }: { purchase: ReviewablePurchase }): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {/* The order number and the date, because a buyer with four of the same
            thing needs to know WHICH one this is about - the seller and the
            delivery date are how they tell them apart. */}
        <span className="font-mono">{purchase.orderNumber}</span> · delivered{' '}
        {formatDate(purchase.deliveredAt)}
      </p>

      <ReviewForm
        orderItemId={purchase.orderItemId}
        productName={purchase.productName}
        sellerName={purchase.sellerName}
      />
    </div>
  );
}
