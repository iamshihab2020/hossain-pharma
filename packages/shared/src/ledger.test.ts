import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_KINDS,
  type Entry,
  UnbalancedTransactionError,
  assertBalanced,
  captureEntries,
  requiresOwner,
} from './ledger.js';
import { CurrencyMismatchError, money } from './money.js';

const bdt = (amount: number) => money(amount, 'BDT');

const ACME = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';

describe('requiresOwner', () => {
  it('is true for SELLER_PAYABLE and false for every other kind', () => {
    for (const kind of ACCOUNT_KINDS) {
      expect(requiresOwner(kind)).toBe(kind === 'SELLER_PAYABLE');
    }
  });
});

describe('assertBalanced', () => {
  it('accepts a balanced pair', () => {
    expect(() =>
      assertBalanced([
        { kind: 'BUYER_RECEIVABLE', ownerOrgId: null, amount: bdt(1000) },
        { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: bdt(-1000) },
      ]),
    ).not.toThrow();
  });

  it('rejects a one-sided transaction, naming the residual', () => {
    let thrown: unknown;
    try {
      assertBalanced([
        { kind: 'BUYER_RECEIVABLE', ownerOrgId: null, amount: bdt(1000) },
        { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: bdt(-999) },
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnbalancedTransactionError);
    expect((thrown as UnbalancedTransactionError).residual).toEqual(bdt(1));
    expect((thrown as Error).message).toContain('1 BDT');
  });

  it('rejects a single entry — one row can never be double entry', () => {
    expect(() =>
      assertBalanced([{ kind: 'BUYER_RECEIVABLE', ownerOrgId: null, amount: bdt(1000) }]),
    ).toThrow(RangeError);
  });

  it('rejects an empty transaction', () => {
    expect(() => assertBalanced([])).toThrow(RangeError);
  });

  it('rejects a zero entry — a zero posting is always a bug, never a rounding result', () => {
    expect(() =>
      assertBalanced([
        { kind: 'BUYER_RECEIVABLE', ownerOrgId: null, amount: bdt(0) },
        { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: bdt(0) },
      ]),
    ).toThrow(/must not be zero/);
  });

  it('refuses to net one currency against another', () => {
    expect(() =>
      assertBalanced([
        { kind: 'BUYER_RECEIVABLE', ownerOrgId: null, amount: money(1000, 'BDT') },
        { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: money(-1000, 'USD') },
      ]),
    ).toThrow(CurrencyMismatchError);
  });

  it('requires an owner on SELLER_PAYABLE', () => {
    expect(() =>
      assertBalanced([
        { kind: 'SELLER_PAYABLE', ownerOrgId: null, amount: bdt(-1000) },
        { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: bdt(1000) },
      ]),
    ).toThrow(/requires an owning organisation/);
  });

  it('refuses an owner on a platform-wide kind', () => {
    expect(() =>
      assertBalanced([
        { kind: 'PLATFORM_CLEARING', ownerOrgId: ACME, amount: bdt(1000) },
        { kind: 'BUYER_RECEIVABLE', ownerOrgId: null, amount: bdt(-1000) },
      ]),
    ).toThrow(/platform-wide/);
  });
});

describe('captureEntries', () => {
  /**
   * PRD 10.1's worked example, asserted line for line. If this test is edited to
   * match the code, the code is wrong - these numbers are the specification.
   *
   *   DR  buyer_receivable          1000
   *   CR  platform_clearing               1000
   *   DR  platform_clearing          600
   *   CR  seller_payable:acme               540
   *   CR  platform_revenue:commission        60
   *   DR  platform_clearing          400
   *   CR  seller_payable:beta               360
   *   CR  platform_revenue:commission        40
   */
  it('reproduces the PRD 10.1 worked example exactly', () => {
    const entries = captureEntries([
      { orgId: ACME, gross: bdt(600), commission: bdt(60) },
      { orgId: BETA, gross: bdt(400), commission: bdt(40) },
    ]);

    expect(entries).toEqual<Entry[]>([
      { kind: 'BUYER_RECEIVABLE', ownerOrgId: null, amount: bdt(1000) },
      { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: bdt(-1000) },
      { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: bdt(600) },
      { kind: 'SELLER_PAYABLE', ownerOrgId: ACME, amount: bdt(-540) },
      { kind: 'PLATFORM_REVENUE_COMMISSION', ownerOrgId: null, amount: bdt(-60) },
      { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: bdt(400) },
      { kind: 'SELLER_PAYABLE', ownerOrgId: BETA, amount: bdt(-360) },
      { kind: 'PLATFORM_REVENUE_COMMISSION', ownerOrgId: null, amount: bdt(-40) },
    ]);
  });

  it('balances for a single seller', () => {
    const entries = captureEntries([{ orgId: ACME, gross: bdt(4200), commission: bdt(420) }]);
    expect(sum(entries)).toBe(0);
  });

  it('omits the commission entry entirely at zero commission rather than posting zero', () => {
    const entries = captureEntries([{ orgId: ACME, gross: bdt(500), commission: bdt(0) }]);
    expect(entries.some((e) => e.kind === 'PLATFORM_REVENUE_COMMISSION')).toBe(false);
    expect(sum(entries)).toBe(0);
  });

  it('omits the payable entry when commission takes the whole gross', () => {
    const entries = captureEntries([{ orgId: ACME, gross: bdt(500), commission: bdt(500) }]);
    expect(entries.some((e) => e.kind === 'SELLER_PAYABLE')).toBe(false);
    expect(sum(entries)).toBe(0);
  });

  it('rejects commission exceeding gross, naming the organisation', () => {
    expect(() =>
      captureEntries([{ orgId: ACME, gross: bdt(100), commission: bdt(101) }]),
    ).toThrow(new RegExp(ACME));
  });

  it('rejects a capture with no sellers', () => {
    expect(() => captureEntries([])).toThrow(RangeError);
  });

  /**
   * The property that matters: whatever the split, the books balance and the
   * money is fully attributed. 500 pseudo-random cases with a fixed seed, so a
   * failure is reproducible rather than a one-off red build.
   */
  it('balances and attributes fully across 500 random splits', () => {
    let seed = 20260904;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };

    for (let run = 0; run < 500; run += 1) {
      const sellerCount = 1 + next(5);
      const splits = Array.from({ length: sellerCount }, (_, i) => {
        const gross = 1 + next(1_000_000);
        const bps = next(3001);
        return {
          orgId: `org-${i}`,
          gross: bdt(gross),
          commission: bdt(Math.round((gross * bps) / 10_000)),
        };
      });

      const entries = captureEntries(splits);
      expect(sum(entries)).toBe(0);

      const receivable = totalFor(entries, 'BUYER_RECEIVABLE');
      const payable = -totalFor(entries, 'SELLER_PAYABLE');
      const commission = -totalFor(entries, 'PLATFORM_REVENUE_COMMISSION');
      expect(payable + commission).toBe(receivable);
    }
  });
});

function sum(entries: readonly Entry[]): number {
  return entries.reduce((acc, e) => acc + e.amount.amount, 0);
}

function totalFor(entries: readonly Entry[], kind: Entry['kind']): number {
  return entries.filter((e) => e.kind === kind).reduce((acc, e) => acc + e.amount.amount, 0);
}
