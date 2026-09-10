import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { endpoints, type OrderView } from '@nexmarket/api-client';
import { apiGet, isSignedIn } from '@/lib/api/server';
import { activeOrg } from '@/lib/api/queries';
import { OrderStatusBadge } from '@/app/orders/page';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDate, formatMoney, plural } from '@/lib/format';

export const metadata: Metadata = { title: 'Orders to fulfil' };

/**
 * The seller's order queue.
 *
 * A functional skeleton, deliberately: `DESIGN-DIRECTION.md` defers the
 * designed console until the fulfilment states settle, and they settle in this
 * phase. What it must get right today is the shape of the work - what is
 * waiting, what is late to accept, what is half out the door - so the design
 * pass has something true to lay out.
 */
export default async function SellerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; status?: string }>;
}): Promise<ReactNode> {
  if (!(await isSignedIn())) redirect('/signin?next=/seller/orders');

  const org = await activeOrg();
  if (org === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-semibold">Orders to fulfil</h1>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          You are not a member of a selling organisation yet. Once you are, the orders your
          customers place arrive here.
        </p>
      </div>
    );
  }

  const { cursor } = await searchParams;
  const orders = await apiGet(endpoints.sellerOrders(cursor), { auth: true, tenantId: org.id });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Orders to fulfil</h1>
        <p className="text-sm text-muted-foreground">{org.displayName}</p>
      </header>

      {orders.items.length === 0 ? (
        <p className="mt-8 max-w-prose text-sm text-muted-foreground">
          Nothing waiting. Orders appear here the moment a buyer pays, and you accept them before
          picking anything.
        </p>
      ) : (
        <>
          <ul className="mt-6 flex flex-col gap-3">
            {orders.items.map((order) => (
              <li key={order.id}>
                <Card className="transition-none">
                  <Link href={`/seller/orders/${order.id}`} className="block">
                    <CardContent className="flex items-start justify-between gap-4 p-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm">{order.orderNumber}</span>
                          <OrderStatusBadge status={order.status} />
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatDate(order.placedAt)} ·{' '}
                          {plural(order.items.length, 'line', 'lines')} ·{' '}
                          {summarise(order)}
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
                <Link href={`/seller/orders?cursor=${encodeURIComponent(orders.nextCursor)}`}>
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

/** Units, not lines: a picker carries units. */
function summarise(order: OrderView): string {
  const units = order.items.reduce((total, item) => total + item.quantity, 0);
  return plural(units, 'unit', 'units');
}
