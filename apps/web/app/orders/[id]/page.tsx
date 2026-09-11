import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { getDeliverySlots, getOrder, getReturnPickups } from '@/lib/api/queries';
import { ApiError, isSignedIn } from '@/lib/api/server';
import { OrderStatusBadge } from '@/app/orders/page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatMoney } from '@/lib/format';
import { OrderTimeline } from '@/components/order-timeline';
import { ShipmentCard } from '@/components/shipment-card';
import { ReturnPickupPanel } from '@/components/return-pickup';
import { marketToday } from '@/lib/delivery';

export const metadata: Metadata = { title: 'Order' };

type Params = { params: Promise<{ id: string }> };

/**
 * One order, which means one seller.
 *
 * Everything here is a SNAPSHOT taken when the order was placed - the product
 * name, the SKU, the unit price. The listing may be repriced or archived
 * tomorrow; an order that rendered today's price would be a dispute rather than
 * a record.
 */
export default async function OrderDetailPage({ params }: Params): Promise<ReactNode> {
  if (!(await isSignedIn())) redirect('/signin?next=/orders');

  const { id } = await params;

  let order;
  try {
    order = await getOrder(id);
  } catch (error) {
    // 404 covers "not yours" as well as "does not exist", and that is the API
    // being careful rather than vague: a 403 would confirm the order is real.
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  /**
   * Collection windows come from the DELIVERY address, not a new one.
   *
   * A courier collects from where the parcel went - asking the buyer for an
   * address again would let them send a van somewhere the order never was, and
   * the API refuses a slot outside the delivered zone anyway.
   *
   * Fetched only for a delivered order, because that is the only state the
   * panel renders in, and two requests for a panel nobody sees is two requests
   * on every order page.
   */
  const delivered = order.status === 'DELIVERED';
  const [returnSlots, pickups] = delivered
    ? await Promise.all([
        getDeliverySlots(order.shippingAddress.postcode, order.shippingAddress.countryCode),
        getReturnPickups(order.id),
      ])
    : [[], []];
  const pickup = pickups.find((entry) => entry.status === 'SCHEDULED') ?? null;
  const today = marketToday().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/orders"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        All orders
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-xl font-semibold">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.sellerName} · placed {formatDate(order.placedAt)}
          </p>
        </div>
        <OrderStatusBadge status={order.status} />
      </header>

      <Card className="mt-6">
        <CardHeader className="py-4">
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-sunk hover:bg-sunk">
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">{item.productName}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {item.variantSku}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular">{item.quantity}</TableCell>
                    <TableCell className="text-right tabular">
                      {formatMoney(item.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular">
                      {formatMoney(item.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Separator />

          <dl className="flex flex-col gap-2 p-4 text-sm">
            <Row label="Subtotal" value={formatMoney(order.subtotal)} />
            <Row label="Delivery" value={formatMoney(order.shipping)} />
            <Row label="VAT" value={formatMoney(order.tax)} />
            <Separator className="my-1" />
            <div className="flex justify-between gap-4">
              <dt className="font-medium">Total</dt>
              <dd className="text-lg font-semibold tabular">{formatMoney(order.total)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {order.shipments.length > 0 && (
        <section className="mt-6">
          <h2 className="text-base font-medium">
            {order.shipments.length === 1 ? 'Your parcel' : 'Your parcels'}
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {order.shipments.map((shipment) => (
              <ShipmentCard key={shipment.id} shipment={shipment} items={order.items} />
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6">
        <Link
          href={`/orders/${order.id}/invoice`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          View invoice
        </Link>
      </p>

      {/* Only once it has ARRIVED. Nothing can be collected that has not been
          delivered, and an order still in transit that the buyer no longer
          wants is a CANCELLATION - a different operation with a different
          ledger consequence, which Phase 5 already built. */}
      {order.status === 'DELIVERED' && (
        <section className="mt-8 rounded-lg border p-4">
          <h2 className="text-base font-medium">Send it back</h2>
          <div className="mt-3">
            <ReturnPickupPanel
              orderId={order.id}
              slots={returnSlots}
              existing={pickup}
              today={today}
            />
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-base font-medium">History</h2>
        <div className="mt-4">
          <OrderTimeline events={order.timeline} sellerName={order.sellerName} />
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
