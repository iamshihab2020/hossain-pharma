import type { OrderDetail } from '@nexmarket/api-client';
import { describe, expect, it } from 'vitest';
import { addressLines, invoiceRows, pickTotal } from './document.js';

const bdt = (amount: number) => ({ amount, currency: 'BDT' });

const order = (over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    id: 'o1',
    createdAt: '2026-09-10T10:00:00.000Z',
    orderNumber: 'NM-1',
    status: 'PAID',
    sellerId: 's1',
    sellerName: 'Bengal Tech',
    subtotal: bdt(30_000),
    shipping: bdt(6_900),
    tax: bdt(4_500),
    total: bdt(41_400),
    placedAt: '2026-09-10T10:00:00.000Z',
    items: [],
    shipments: [],
    timeline: [],
    ...over,
  }) as OrderDetail;

describe('invoiceRows', () => {
  it('reads every figure off the order rather than recomputing it', () => {
    // The order recorded what was charged on the day. A document that
    // recalculated VAT would disagree with the payment the moment a rate
    // changed - and that disagreement is a dispute.
    const rows = invoiceRows(
      order({ subtotal: bdt(100), shipping: bdt(0), tax: bdt(15), total: bdt(115) }),
    );
    expect(rows.map((row) => row.amount.amount)).toEqual([100, 0, 15, 115]);
  });

  it('does not make the rows add up when the order says otherwise', () => {
    // If a total ever disagrees with its parts, the document shows what the
    // order says. Papering over it would hide the bug that caused it.
    const rows = invoiceRows(order({ total: bdt(999) }));
    expect(rows.at(-1)?.amount.amount).toBe(999);
  });

  it('emphasises the total and nothing else', () => {
    const rows = invoiceRows(order());
    expect(rows.filter((row) => row.emphasis === true)).toHaveLength(1);
    expect(rows.at(-1)?.label).toBe('Total');
  });
});

describe('addressLines', () => {
  it('builds a printable block from the snapshot', () => {
    expect(
      addressLines({
        recipientName: 'Rafiq Hasan',
        line1: '12 Elephant Road',
        city: 'Dhaka',
        district: 'Dhaka',
        postcode: '1205',
        countryCode: 'BD',
        phone: '+8801700000000',
      }),
    ).toEqual([
      'Rafiq Hasan',
      '12 Elephant Road',
      'Dhaka, Dhaka',
      '1205 BD',
      '+8801700000000',
    ]);
  });

  it('drops missing parts rather than printing blank lines', () => {
    expect(addressLines({ recipientName: 'Rafiq Hasan', line1: '12 Elephant Road' })).toEqual([
      'Rafiq Hasan',
      '12 Elephant Road',
    ]);
  });

  it('survives an address column that is not the shape we expect', () => {
    // shippingAddress is jsonb. Nothing guarantees its shape years from now,
    // and a courier label is not the place to throw.
    expect(addressLines(null)).toEqual([]);
    expect(addressLines({ recipientName: 42, city: {} })).toEqual([]);
  });

  it('ignores whitespace-only fields', () => {
    expect(addressLines({ recipientName: '   ', line1: 'Somewhere' })).toEqual(['Somewhere']);
  });
});

describe('pickTotal', () => {
  it('counts units, because a picker carries units and not lines', () => {
    expect(pickTotal([{ quantity: 2 }, { quantity: 3 }])).toBe(5);
  });

  it('is zero for an empty parcel', () => {
    expect(pickTotal([])).toBe(0);
  });
});
