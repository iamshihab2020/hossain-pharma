import { type Money, add, money, subtract } from './money.js';

/**
 * The double-entry ledger's rules, as pure functions.
 *
 * PRD 10.1: "The ledger is the source of truth. Order status never derives from
 * a gateway response read by the browser." Everything here is framework-free and
 * database-free on purpose - the same rule that `LedgerService.post` enforces
 * before it writes is the rule tested here, so there is one definition of
 * "balanced" rather than two that agree until they don't.
 *
 * The persisted half of the invariant is a DEFERRED CONSTRAINT TRIGGER in
 * migration 0012. This module is the fast, precise failure; the trigger is the
 * one that cannot be bypassed by code written next year. See ADR 0016.
 */

/**
 * DEBIT IS POSITIVE, CREDIT IS NEGATIVE, and the balance rule is therefore
 * literally `sum === 0`.
 *
 * The alternative - a `direction` enum with positive amounts - reads better in
 * a row viewer but turns every balance check into
 * `SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END)`. Every
 * place that forgets the CASE produces a wrong number that still looks like a
 * number, and by Phase 10 there will be many such places. Readability is bought
 * back with a view that renders DR/CR columns for humans.
 */
export const ACCOUNT_KINDS = [
  /** Owed by buyers. Debited when an order is placed. */
  'BUYER_RECEIVABLE',
  /** Money in transit between the buyer and the sellers. */
  'PLATFORM_CLEARING',
  /** Owed to one seller. The only kind that carries an owner. */
  'SELLER_PAYABLE',
  /** The platform's take. */
  'PLATFORM_REVENUE_COMMISSION',
  /**
   * Delivered but not yet collected.
   *
   * Created in Phase 4 because the COD adapter must debit something at
   * placement; posted against properly in Phase 6, where the money actually
   * arrives. A chart of accounts that grows a kind per phase makes every
   * historical balance query phase-dependent, so the kind lands with the phase
   * that first needs to name it.
   */
  'COD_RECEIVABLE',
] as const;

export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** Only SELLER_PAYABLE is per-organisation. The rest are platform-wide. */
export function requiresOwner(kind: AccountKind): boolean {
  return kind === 'SELLER_PAYABLE';
}

export type Entry = {
  readonly kind: AccountKind;
  /** The organisation this account belongs to, for SELLER_PAYABLE only. */
  readonly ownerOrgId: string | null;
  /** Signed: positive debits, negative credits. Never zero. */
  readonly amount: Money;
};

export class UnbalancedTransactionError extends Error {
  constructor(readonly residual: Money) {
    super(
      `Ledger transaction does not balance: entries sum to ${residual.amount} ${residual.currency}, expected 0`,
    );
    this.name = 'UnbalancedTransactionError';
  }
}

/**
 * Every rule a set of entries must satisfy before it may be written.
 *
 * Throws rather than returning a result, because there is exactly one correct
 * response to an unbalanced transaction and making it optional to check would
 * be the whole problem.
 */
export function assertBalanced(entries: readonly Entry[]): void {
  if (entries.length < 2) {
    throw new RangeError(
      `A ledger transaction needs at least two entries, received ${entries.length}`,
    );
  }

  const [first, ...rest] = entries as [Entry, ...Entry[]];
  let total = first.amount;

  for (const entry of entries) {
    if (entry.amount.amount === 0) {
      throw new RangeError(
        `Ledger entries must not be zero: ${entry.kind} posted ${entry.amount.currency} 0`,
      );
    }
    if (requiresOwner(entry.kind) && entry.ownerOrgId === null) {
      throw new RangeError(`${entry.kind} requires an owning organisation`);
    }
    if (!requiresOwner(entry.kind) && entry.ownerOrgId !== null) {
      throw new RangeError(`${entry.kind} is platform-wide and must not carry an owner`);
    }
  }

  // add() raises CurrencyMismatchError, which is the right failure: a ledger
  // that nets BDT against USD is not balanced, it is meaningless. PRD 10.6 -
  // no implicit conversion in the ledger, ever.
  for (const entry of rest) {
    total = add(total, entry.amount);
  }

  if (total.amount !== 0) {
    throw new UnbalancedTransactionError(total);
  }
}

export type SellerSplit = {
  readonly orgId: string;
  /** What the buyer pays this seller, before commission. */
  readonly gross: Money;
  /** The platform's cut of `gross`. */
  readonly commission: Money;
};

/**
 * The PRD 10.1 worked example, generalised: one buyer payment split across N
 * sellers with a per-seller commission.
 *
 *     DR  buyer_receivable          1000
 *     CR  platform_clearing               1000
 *     DR  platform_clearing          600
 *     CR  seller_payable:acme               540
 *     CR  platform_revenue:commission        60
 *     ...
 *
 * The clearing account is not decoration. Without it the buyer's single
 * receivable would have to be credited in N pieces, and the moment a refund or
 * a partial capture arrives there is no row representing "money received but
 * not yet attributed" - which is exactly the state COD spends days in.
 */
export function captureEntries(splits: readonly SellerSplit[]): Entry[] {
  if (splits.length === 0) {
    throw new RangeError('A capture needs at least one seller split');
  }

  const [first, ...rest] = splits as [SellerSplit, ...SellerSplit[]];
  let total = first.gross;
  for (const split of rest) {
    total = add(total, split.gross);
  }

  const entries: Entry[] = [
    { kind: 'BUYER_RECEIVABLE', ownerOrgId: null, amount: total },
    { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: negate(total) },
  ];

  for (const split of splits) {
    const payable = subtract(split.gross, split.commission);
    if (payable.amount < 0) {
      throw new RangeError(
        `Commission ${split.commission.amount} exceeds gross ${split.gross.amount} for organisation ${split.orgId}`,
      );
    }
    entries.push({ kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: split.gross });
    if (payable.amount !== 0) {
      entries.push({ kind: 'SELLER_PAYABLE', ownerOrgId: split.orgId, amount: negate(payable) });
    }
    if (split.commission.amount !== 0) {
      entries.push({
        kind: 'PLATFORM_REVENUE_COMMISSION',
        ownerOrgId: null,
        amount: negate(split.commission),
      });
    }
  }

  assertBalanced(entries);
  return entries;
}

function negate(m: Money): Money {
  return money(-m.amount, m.currency);
}
