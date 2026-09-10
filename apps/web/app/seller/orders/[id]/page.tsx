import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { endpoints, type OrderDetail } from '@nexmarket/api-client';
import { ApiError, apiGet, isSignedIn } from '@/lib/api/server';
import { activeOrg } from '@/lib/api/queries';
import { OrderStatusBadge } from '@/app/orders/page';
import { OrderTimeline } from '@/components/order-timeline';
import { FulfilmentPanel } from '@/components/fulfilment-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatMoney, plural } from '@/lib/format';

export const metadata: Metadata = { title: 'Order' };

type Params = { params: Promise<{ id: string }> };

/**
 * One order, from the side that has to send it.
 *
 * The seller sees ONLY their own lines on a basket the buyer spread across
 * several sellers, and that is enforced by row-level security rather than by
 * anything on this page - which is why there is no filtering here to read.
 */
export default async function SellerOrderPage({ params }: Params): Promise<ReactNode> {
  if (!(await isSignedIn())) redirect('/signin?next=/seller/orders');

  const org = await activeOrg();
  if (org === null) redirect('/seller/orders');

  const { id } = await params;

  let order: OrderDetail;
  try {
    order = await apiGet(endpoints.sellerOrder(id), { auth: true, tenantId: org.id });
  } catch (error) {
    // 404 covers "not yours" as well as "does not exist". Under RLS another
    // seller's order genuinely does not exist, and a 403 would confirm it does.
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const outstanding = outstandingOf(order);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/seller/orders"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Orders to fulfil
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-xl font-semibold">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Placed {formatDate(order.placedAt)} · {plural(order.items.length, 'line', 'lines')}
          </p>
        </div>
        <OrderStatusBadge status={order.status} />
      </header>

      <Card className="mt-6">
        <CardHeader className="py-4">
          <CardTitle className="text-base">To send</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4 pt-0 text-sm">
          {order.items.map((item) => {
            const remaining = outstanding.find((row) => row.item.id === item.id)?.remaining ?? 0;
            return (
              <div key={item.id} className="flex items-baseline justify-between gap-4">
                <div>
                  <p className="font-medium">{item.productName}</p>
                  <p className="font-mono text-xs text-muted-foreground">{item.variantSku}</p>
                </div>
                <p className="tabular text-muted-foreground">
                  {remaining === 0
                    ? `${String(item.quantity)} sent`
                    : `${String(remaining)} of ${String(item.quantity)} left`}
                </p>
              </div>
            );
          })}
          <div className="flex justify-between border-t border-border pt-3">
            <span className="font-medium">Order total</span>
            <span className="font-semibold tabular">{formatMoney(order.total)}</span>
          </div>
        </CardContent>
      </Card>

      <p className="mt-4">
        <Link
          href={`/seller/orders/${order.id}/packing-slip`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Print packing slip
        </Link>
      </p>

      <section className="mt-6">
        <FulfilmentPanel order={order} tenantId={org.id} outstanding={outstanding} />
      </section>

      <section className="mt-8">
        <h2 className="text-base font-medium">History</h2>
        <div className="mt-4">
          <OrderTimeline events={order.timeline} sellerName={org.displayName} />
        </div>
      </section>
    </div>
  );
}

/**
 * What is left to send on each line.
 *
 * Shipped units are summed from the parcels rather than read off the line,
 * because the API does not store a shipped counter - a denormalised one would
 * have two writers and drift. Cancelled units are already excluded server-side
 * from what the panel is allowed to dispatch.
 */
function outstandingOf(order: OrderDetail): { item: OrderDetail['items'][number]; remaining: number }[] {
  const shipped = new Map<string, number>();
  for (const shipment of order.shipments) {
    for (const line of shipment.items) {
      shipped.set(line.orderItemId, (shipped.get(line.orderItemId) ?? 0) + line.quantity);
    }
  }

  return order.items
    .map((item) => ({ item, remaining: item.quantity - (shipped.get(item.id) ?? 0) }))
    .filter((row) => row.remaining > 0);
}
