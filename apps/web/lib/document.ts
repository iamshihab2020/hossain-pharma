import type { Money, OrderDetail } from '@nexmarket/api-client';

/**
 * The money rows on an invoice or a packing slip.
 *
 * Every figure is READ off the order, never recomputed. The order recorded what
 * was charged on the day - VAT at the rate that applied, delivery at the rate
 * quoted - and a document that recalculated them would disagree with the
 * payment the moment a rate changed. That disagreement is a dispute, and it is
 * the reason `order_items` snapshots prices at all.
 */
export type DocumentRow = { label: string; amount: Money; emphasis?: boolean };

export function invoiceRows(order: OrderDetail): DocumentRow[] {
  return [
    { label: 'Subtotal', amount: order.subtotal },
    { label: 'Delivery', amount: order.shipping },
    { label: 'VAT', amount: order.tax },
    { label: 'Total', amount: order.total, emphasis: true },
  ];
}

/**
 * The address as a printable block.
 *
 * A snapshot on the order rather than a lookup, so a customer who moves house
 * next year does not rewrite where last year's parcel was sent.
 */
export type ShippingAddress = {
  recipientName?: unknown;
  phone?: unknown;
  line1?: unknown;
  line2?: unknown;
  city?: unknown;
  district?: unknown;
  postcode?: unknown;
  countryCode?: unknown;
};

export function addressLines(address: ShippingAddress | null | undefined): string[] {
  if (address === null || address === undefined) return [];
  const parts = [
    text(address.recipientName),
    text(address.line1),
    text(address.line2),
    joinNonEmpty([text(address.city), text(address.district)], ', '),
    joinNonEmpty([text(address.postcode), text(address.countryCode)], ' '),
    text(address.phone),
  ];
  return parts.filter((part): part is string => part !== null);
}

/** How many units a packing slip is asking someone to pick. */
export function pickTotal(items: readonly { quantity: number }[]): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function joinNonEmpty(parts: (string | null)[], separator: string): string | null {
  const kept = parts.filter((part): part is string => part !== null);
  return kept.length === 0 ? null : kept.join(separator);
}
