import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { endpoints, type OrderDetail } from '@nexmarket/api-client';
import { ApiError, apiGet, isSignedIn } from '@/lib/api/server';
import { activeOrg } from '@/lib/api/queries';
import { PrintSheet } from '@/components/print-sheet';
import { addressLines, pickTotal } from '@/lib/document';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Packing slip' };

type Params = { params: Promise<{ id: string }> };

/**
 * What goes in the box, for the person putting it there.
 *
 * No prices. A packing slip is a picking instruction and a receipt for the
 * customer opening the parcel; money belongs on the invoice, and printing it
 * here is how a gift arrives with its price attached.
 */
export default async function PackingSlipPage({ params }: Params): Promise<ReactNode> {
  if (!(await isSignedIn())) redirect('/signin?next=/seller/orders');

  const org = await activeOrg();
  if (org === null) redirect('/seller/orders');

  const { id } = await params;

  let order: OrderDetail;
  try {
    order = await apiGet(endpoints.sellerOrder(id), { auth: true, tenantId: org.id });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const address = addressLines(order.shippingAddress);

  return (
    <PrintSheet title={`Packing slip · ${order.orderNumber}`}>
      <div className="mt-1 flex flex-wrap justify-between gap-4 text-sm text-muted-foreground">
        <p>{org.displayName}</p>
        <p>Placed {formatDate(order.placedAt)}</p>
      </div>

      {address.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-medium">Deliver to</h2>
          <address className="mt-1 not-italic text-sm leading-6">
            {address.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        </section>
      )}

      <table className="mt-8 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="pb-2 font-medium">Item</th>
            <th className="pb-2 font-medium">SKU</th>
            <th className="pb-2 text-right font-medium">Qty</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id} className="border-b border-border/60">
              <td className="py-2">{item.productName}</td>
              <td className="py-2 font-mono text-xs">{item.variantSku}</td>
              <td className="py-2 text-right tabular">{item.quantity}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 font-medium" colSpan={2}>
              Units in this order
            </td>
            <td className="pt-3 text-right font-medium tabular">{pickTotal(order.items)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="mt-8 text-xs text-muted-foreground">
        Check every line before sealing the box. What you send is what the buyer is told arrived.
      </p>
    </PrintSheet>
  );
}
