import { describe, expect, it } from 'vitest';
import { money } from './money.js';
import { assertBalanced } from './ledger.js';
import { commissionFor } from './pricing.js';
import { releaseEntries, reversalEntries, shareFor, unitShares } from './fulfilment.js';

const BDT = 'BDT';
const consumedNone = new Map<string, number>();

describe('unitShares', () => {
  it('splits an order total across units with no minor unit lost', () => {
    const shares = unitShares(money(300, BDT), money(15, BDT), [
      { orderItemId: 'a', quantity: 3, unitPriceAmount: 100 },
    ]);
    const units = shares.get('a') ?? [];
    expect(units).toHaveLength(3);
    expect(units.reduce((n, u) => n + u.total.amount, 0)).toBe(300);
    expect(units.reduce((n, u) => n + u.commission.amount, 0)).toBe(15);
  });

  it('sums to the recorded whole where a fresh percentage would not', () => {
    // The reason this module exists. unit price 1, quantity 3, 5000 bps:
    // commissionFor rounds 1.5 up to 2, while three per-unit roundings of 0.5
    // would each round up, to 3.
    const recorded = commissionFor(money(3, BDT), 5000);
    expect(recorded.amount).toBe(2);
    expect(commissionFor(money(1, BDT), 5000).amount * 3).toBe(3);

    const shares = unitShares(money(3, BDT), recorded, [
      { orderItemId: 'a', quantity: 3, unitPriceAmount: 1 },
    ]);
    const units = shares.get('a') ?? [];
    expect(units.reduce((n, u) => n + u.commission.amount, 0)).toBe(2);
  });

  it('weights by unit price across lines', () => {
    const shares = unitShares(money(400, BDT), money(20, BDT), [
      { orderItemId: 'a', quantity: 1, unitPriceAmount: 300 },
      { orderItemId: 'b', quantity: 1, unitPriceAmount: 100 },
    ]);
    expect(shares.get('a')?.[0]?.total.amount).toBe(300);
    expect(shares.get('b')?.[0]?.total.amount).toBe(100);
  });

  it('carries order-level shipping and tax into the shares', () => {
    // The total exceeds the sum of the lines: 200 of goods, 50 of shipping and
    // tax. `gross` in a capture is order.total, so the shares must carry it.
    const shares = unitShares(money(250, BDT), money(10, BDT), [
      { orderItemId: 'a', quantity: 2, unitPriceAmount: 100 },
    ]);
    const units = shares.get('a') ?? [];
    expect(units.reduce((n, u) => n + u.total.amount, 0)).toBe(250);
  });

  it('rejects an order with no lines', () => {
    expect(() => unitShares(money(1, BDT), money(0, BDT), [])).toThrow(RangeError);
  });

  it('rejects a line with a non-positive quantity', () => {
    expect(() =>
      unitShares(money(1, BDT), money(0, BDT), [
        { orderItemId: 'a', quantity: 0, unitPriceAmount: 1 },
      ]),
    ).toThrow(RangeError);
  });

  it('rejects a fractional quantity', () => {
    expect(() =>
      unitShares(money(1, BDT), money(0, BDT), [
        { orderItemId: 'a', quantity: 1.5, unitPriceAmount: 1 },
      ]),
    ).toThrow(RangeError);
  });

  it('rejects a mixed-currency order', () => {
    expect(() =>
      unitShares(money(100, BDT), money(5, 'USD'), [
        { orderItemId: 'a', quantity: 1, unitPriceAmount: 100 },
      ]),
    ).toThrow(RangeError);
  });

  it('allocates a zero commission without complaint', () => {
    const shares = unitShares(money(100, BDT), money(0, BDT), [
      { orderItemId: 'a', quantity: 2, unitPriceAmount: 50 },
    ]);
    expect(shares.get('a')?.every((u) => u.commission.amount === 0)).toBe(true);
  });
});

describe('shareFor', () => {
  const shares = () =>
    unitShares(money(300, BDT), money(15, BDT), [
      { orderItemId: 'a', quantity: 3, unitPriceAmount: 100 },
    ]);

  it('takes units in index order from what is unconsumed', () => {
    const first = shareFor(shares(), consumedNone, [{ orderItemId: 'a', quantity: 2 }]);
    const second = shareFor(shares(), new Map([['a', 2]]), [{ orderItemId: 'a', quantity: 1 }]);
    expect(first.total.amount + second.total.amount).toBe(300);
    expect(first.commission.amount + second.commission.amount).toBe(15);
  });

  it('sums across several lines in one pick', () => {
    const multi = unitShares(money(400, BDT), money(20, BDT), [
      { orderItemId: 'a', quantity: 1, unitPriceAmount: 300 },
      { orderItemId: 'b', quantity: 1, unitPriceAmount: 100 },
    ]);
    const share = shareFor(multi, consumedNone, [
      { orderItemId: 'a', quantity: 1 },
      { orderItemId: 'b', quantity: 1 },
    ]);
    expect(share.total.amount).toBe(400);
    expect(share.commission.amount).toBe(20);
  });

  it('refuses to consume more units than remain', () => {
    expect(() => shareFor(shares(), new Map([['a', 2]]), [{ orderItemId: 'a', quantity: 2 }])).toThrow(
      RangeError,
    );
  });

  it('refuses a line the order does not have', () => {
    expect(() => shareFor(shares(), consumedNone, [{ orderItemId: 'zz', quantity: 1 }])).toThrow(
      RangeError,
    );
  });

  it('refuses a non-positive quantity', () => {
    expect(() => shareFor(shares(), consumedNone, [{ orderItemId: 'a', quantity: 0 }])).toThrow(
      RangeError,
    );
  });

  it('refuses a fractional quantity', () => {
    expect(() => shareFor(shares(), consumedNone, [{ orderItemId: 'a', quantity: 1.5 }])).toThrow(
      RangeError,
    );
  });

  it('refuses an empty pick', () => {
    expect(() => shareFor(shares(), consumedNone, [])).toThrow(RangeError);
  });
});

describe('releaseEntries', () => {
  it('moves clearing to payable and commission, and balances', () => {
    const entries = releaseEntries('org-1', { total: money(100, BDT), commission: money(10, BDT) });
    expect(() => assertBalanced(entries)).not.toThrow();
    expect(entries.find((e) => e.kind === 'PLATFORM_CLEARING')?.amount.amount).toBe(100);
    expect(entries.find((e) => e.kind === 'SELLER_PAYABLE')?.amount.amount).toBe(-90);
    expect(entries.find((e) => e.kind === 'PLATFORM_REVENUE_COMMISSION')?.amount.amount).toBe(-10);
  });

  it('names the owning organisation on the payable and nowhere else', () => {
    const entries = releaseEntries('org-1', { total: money(100, BDT), commission: money(10, BDT) });
    expect(entries.find((e) => e.kind === 'SELLER_PAYABLE')?.ownerOrgId).toBe('org-1');
    expect(entries.filter((e) => e.ownerOrgId !== null)).toHaveLength(1);
  });

  it('omits a zero commission rather than posting a zero entry', () => {
    const entries = releaseEntries('org-1', { total: money(100, BDT), commission: money(0, BDT) });
    expect(entries.some((e) => e.kind === 'PLATFORM_REVENUE_COMMISSION')).toBe(false);
    expect(() => assertBalanced(entries)).not.toThrow();
  });

  it('omits a zero payable when commission takes the whole release', () => {
    const entries = releaseEntries('org-1', { total: money(10, BDT), commission: money(10, BDT) });
    expect(entries.some((e) => e.kind === 'SELLER_PAYABLE')).toBe(false);
    expect(() => assertBalanced(entries)).not.toThrow();
  });

  it('refuses a commission larger than the amount released', () => {
    expect(() =>
      releaseEntries('org-1', { total: money(10, BDT), commission: money(11, BDT) }),
    ).toThrow(RangeError);
  });
});

describe('reversalEntries', () => {
  it('returns the buyer receivable and balances', () => {
    const entries = reversalEntries({ total: money(100, BDT), commission: money(10, BDT) });
    expect(() => assertBalanced(entries)).not.toThrow();
    expect(entries.find((e) => e.kind === 'PLATFORM_CLEARING')?.amount.amount).toBe(100);
    expect(entries.find((e) => e.kind === 'BUYER_RECEIVABLE')?.amount.amount).toBe(-100);
  });

  it('credits no seller, because none was ever credited', () => {
    const entries = reversalEntries({ total: money(100, BDT), commission: money(10, BDT) });
    expect(entries.some((e) => e.kind === 'SELLER_PAYABLE')).toBe(false);
  });

  it('refuses a zero reversal', () => {
    expect(() => reversalEntries({ total: money(0, BDT), commission: money(0, BDT) })).toThrow(
      RangeError,
    );
  });
});
