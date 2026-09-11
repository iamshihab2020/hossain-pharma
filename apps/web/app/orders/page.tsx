import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { OrderStatus } from '@nexmarket/api-client';
import { getOrders } from '@/lib/api/queries';
import { describeStatus } from '@/lib/order-timeline';
import { isSignedIn } from '@/lib/api/server';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate, formatMoney, plural } from '@/lib/format';

export const metadata: Metadata = { title: 'Your orders' };

/**
 * The buyer's orders, ACROSS every seller.
 *
 * This read works without a tenant because of the gated `own_orders` policy: a
 * buyer sends no `x-tenant-id`, so the policy applies and is keyed on
 * `app.user_id`. A seller sending a tenant gets their own queue instead, from
 * the same table.
 *
 * Deliberately thin. Phase 5 adds fulfilment states and shipments, and building
 * a rich order history against three statuses would mean rebuilding it then.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  if (!(await isSignedIn())) redirect('/signin?next=/orders');

  const params = await searchParams;
  const placed = typeof params['placed'] === 'string' ? params['placed'] : undefined;
  const cursor = typeof params['cursor'] === 'string' ? params['cursor'] : undefined;

  const orders = await getOrders(cursor);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Your orders</h1>
        {/* The way in to Phase 7, from the only place that has the proof of
            purchase a review hangs off. A "write a review" link in the site
            header would have nothing to point at for the many people who have
            bought nothing. */}
        <Link
          href="/reviews"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Reviews to write
        </Link>
      </div>

      {placed !== undefined && (
        <Alert className="mt-6 border-primary/40 bg-wash">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <AlertTitle>Order placed</AlertTitle>
          <AlertDescription>
            Order <span className="font-mono">{placed}</span> is confirmed. If your
            cart had items from more than one seller, each one is listed
            separately below.
          </AlertDescription>
        </Alert>
      )}

      {orders.items.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No orders yet"
            description="When you place your first order, it will appear here."
          />
          <div className="flex justify-center">
            <Button asChild>
              <Link href="/">Browse products</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ul className="mt-6 flex flex-col gap-3">
            {orders.items.map((order) => (
              <li key={order.id}>
                <Card className="transition-colors hover:border-line-strong">
                  <Link href={`/orders/${order.id}`} className="block">
                    <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm">{order.orderNumber}</span>
                          <OrderStatusBadge status={order.status} />
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {order.sellerName} · {formatDate(order.placedAt)} ·{' '}
                          {plural(order.items.length, 'item', 'items')}
                        </p>
                      </div>
                      <span className="font-semibold tabular">{formatMoney(order.total)}</span>
                    </CardContent>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>

          {orders.nextCursor !== null && (
            <div className="mt-8 flex justify-center">
              <Button variant="outline" asChild>
                <Link href={`/orders?cursor=${encodeURIComponent(orders.nextCursor)}`}>
                  Older orders
                </Link>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Status as a shape as well as a word, so what needs attention reads at a
 * glance. `PENDING_PAYMENT` is the one that does - and it is amber, the same
 * token that marks low stock, because both mean "not settled yet".
 */
/**
 * Eight states, three appearances.
 *
 * The label comes from `describeStatus` so the buyer never meets the enum, and
 * the tone comes from the same place so this component cannot drift from the
 * timeline's idea of what is worth colouring. Most of the lifecycle is neutral:
 * an order moving along normally should not shout.
 */
export function OrderStatusBadge({ status }: { status: OrderStatus }): ReactNode {
  const { label, tone } = describeStatus(status);

  if (tone === 'signal') {
    return (
      <Badge variant="outline" className="border-primary/40 bg-wash font-normal text-primary">
        {label}
      </Badge>
    );
  }
  if (tone === 'warn') {
    return (
      <Badge variant="outline" className="border-warn/40 bg-warn-wash font-normal text-warn">
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      {label}
    </Badge>
  );
}
