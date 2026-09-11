import { type Money, add, money } from './money.js';

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

/**
 * A capture, after Phase 5: the buyer owes, and the money lands in clearing.
 *
 *     DR  buyer_receivable          1000
 *     CR  platform_clearing               1000
 *
 * It used to credit each seller's payable here, and it does not any more. The
 * reason is the one clearing was always for - "money received but not yet
 * attributed". DISPATCH is the attribution; see `releaseEntries` in
 * fulfilment.ts. A seller who has not shipped is not owed, and a ledger that
 * said otherwise overstated every payable between capture and dispatch.
 *
 * This also makes card and COD identical from here on. COD_ACCRUAL already
 * posted only a receivable and a clearing credit (ADR 0016 decision 5), so both
 * methods now leave the seller's gross in the same place and release it through
 * the same code path - which is what will let Phase 6's COD collection be a
 * posting against COD_RECEIVABLE and nothing else.
 *
 * The clearing account is not decoration. Without it the buyer's single
 * receivable would have to be credited in N pieces, and the moment a refund or
 * a partial capture arrives there is no row representing "money received but
 * not yet attributed" - which is exactly the state COD spends days in, and now
 * also the state every card order spends between payment and dispatch.
 */
export function captureEntries(total: Money): Entry[] {
  if (total.amount === 0) {
    throw new RangeError('A capture of zero is always a bug');
  }

  const entries: Entry[] = [
    { kind: 'BUYER_RECEIVABLE', ownerOrgId: null, amount: total },
    { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: negate(total) },
  ];

  assertBalanced(entries);
  return entries;
}

/**
 * Cash taken at the door, days after the parcel left.
 *
 *     DR  buyer_receivable          1000
 *     CR  cod_receivable                  1000
 *
 * The posting `captureEntries`' own comment predicted: "against COD_RECEIVABLE
 * and nothing else". COD_ACCRUAL already credited clearing at placement, so
 * collection has no clearing leg - it converts an asset the platform was
 * *owed in cash* into the same recognised buyer receivable a card capture
 * produces. After it, a COD order's postings are indistinguishable from a
 * settled card order's, which is the property that lets one payout statement
 * reconcile both (PRD, Phase 10).
 *
 * PARTIAL IS A FIRST-CLASS CASE. A courier can come back short, and PRD 10.1
 * names the reconciliation dashboard's three columns as collected, expected and
 * outstanding. Posting only the amount actually collected is what leaves the
 * shortfall sitting in COD_RECEIVABLE where that dashboard reads it, instead of
 * writing off a gap nobody agreed to.
 */
export function codCollectionEntries(collected: Money): Entry[] {
  if (collected.amount <= 0) {
    throw new RangeError('A cash collection must be a positive amount');
  }

  const entries: Entry[] = [
    { kind: 'BUYER_RECEIVABLE', ownerOrgId: null, amount: collected },
    { kind: 'COD_RECEIVABLE', ownerOrgId: null, amount: negate(collected) },
  ];

  assertBalanced(entries);
  return entries;
}

function negate(m: Money): Money {
  return money(-m.amount, m.currency);
}
