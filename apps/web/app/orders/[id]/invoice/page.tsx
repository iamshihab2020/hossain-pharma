import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getOrder } from '@/lib/api/queries';
import { ApiError, isSignedIn } from '@/lib/api/server';
import { PrintSheet } from '@/components/print-sheet';
import { addressLines, invoiceRows } from '@/lib/document';
import { formatDate, formatMoney } from '@/lib/format';

export const metadata: Metadata = { title: 'Invoice' };

type Params = { params: Promise<{ id: string }> };

/**
 * What the buyer paid, and to whom.
 *
 * One invoice per SELLER, because one order is one seller - a basket spread
 * across three of them produced three orders and gets three invoices. Rolling
 * them into one document would name a vendor who did not sell most of it.
 *
 * Every figure is read off the order rather than recomputed. See `document.ts`.
 */
export default async function InvoicePage({ params }: Params): Promise<ReactNode> {
  if (!(await isSignedIn())) redirect('/signin?next=/orders');

  const { id } = await params;

  let order;
  try {
    order = await getOrder(id);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const address = addressLines(order.shippingAddress);

  return (
    <PrintSheet title={`Invoice · ${order.orderNumber}`}>
      <div className="mt-1 flex flex-wrap justify-between gap-4 text-sm text-muted-foreground">
        <p>Sold by {order.sellerName}</p>
        <p>Placed {formatDate(order.placedAt)}</p>
      </div>

      {address.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-medium">Delivered to</h2>
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
            <th className="pb-2 text-right font-medium">Qty</th>
            <th className="pb-2 text-right font-medium">Unit</th>
            <th className="pb-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id} className="border-b border-border/60">
              <td className="py-2">
                {item.productName}
                <span className="block font-mono text-xs text-muted-foreground">
                  {item.variantSku}
                </span>
              </td>
              <td className="py-2 text-right tabular">{item.quantity}</td>
              <td className="py-2 text-right tabular">{formatMoney(item.unitPrice)}</td>
              <td className="py-2 text-right tabular">{formatMoney(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto mt-6 flex max-w-xs flex-col gap-2 text-sm">
        {invoiceRows(order).map((row) => (
          <div
            key={row.label}
            className={
              row.emphasis === true
                ? 'flex justify-between gap-4 border-t border-border pt-2 font-semibold'
                : 'flex justify-between gap-4'
            }
          >
            <dt className={row.emphasis === true ? '' : 'text-muted-foreground'}>{row.label}</dt>
            <dd className="tabular">{formatMoney(row.amount, { decimals: true })}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-10 text-xs text-muted-foreground">
        VAT is shown as it was charged on the day this order was placed.
      </p>
    </PrintSheet>
  );
}
