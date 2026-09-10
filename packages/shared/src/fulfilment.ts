import { allocate, money, subtract, type Money } from './money.js';
import { assertBalanced, type Entry } from './ledger.js';

export type OrderLine = {
  readonly orderItemId: string;
  readonly quantity: number;
  readonly unitPriceAmount: number;
};

export type Pick = { readonly orderItemId: string; readonly quantity: number };

/** What one unit of an order is worth, and what the platform takes from it. */
export type UnitLedger = { readonly total: Money; readonly commission: Money };

/**
 * The order total, split across its individual units, once.
 *
 * `gross` in a capture is `order.total` - the subtotal PLUS order-level shipping
 * and tax - so a shipment carrying some units is an amount computed at order
 * level and then split. That is exactly what `allocate` exists for, and Phase 4's
 * plan (F-1) predicted it would land at a cart-wide promotion or a partial
 * refund. A partial shipment got there first.
 *
 * Recomputing a shipment's share as a fresh percentage of what it carries is the
 * obvious alternative, and it is wrong in a way nothing catches. Unit price 1,
 * quantity 3, 5000 bps: the order records commission 2, while three per-unit
 * roundings of 0.5 each round away from zero and produce 3. The entries still
 * balance. The constraint trigger is still satisfied. The platform's take is
 * simply not the number the order recorded.
 */
export function unitShares(
  orderTotal: Money,
  orderCommission: Money,
  lines: readonly OrderLine[],
): Map<string, UnitLedger[]> {
  if (lines.length === 0) {
    throw new RangeError('An order with no lines has nothing to allocate');
  }
  if (orderCommission.currency !== orderTotal.currency) {
    throw new RangeError(
      `Order total is ${orderTotal.currency} but commission is ${orderCommission.currency}`,
    );
  }

  const keys: string[] = [];
  const ratios: number[] = [];
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new RangeError(`Line ${line.orderItemId} has quantity ${line.quantity}`);
    }
    for (let i = 0; i < line.quantity; i += 1) {
      keys.push(line.orderItemId);
      // Weighted by unit price, so a 300 unit and a 100 unit carry the order's
      // shipping and tax in proportion to what they cost.
      ratios.push(line.unitPriceAmount);
    }
  }

  const totals = allocate(orderTotal, ratios);
  const commissions = allocate(orderCommission, ratios);

  const shares = new Map<string, UnitLedger[]>();
  keys.forEach((key, index) => {
    const list = shares.get(key) ?? [];
    list.push({
      total: totals[index] as Money,
      commission: commissions[index] as Money,
    });
    shares.set(key, list);
  });
  return shares;
}

/**
 * What a shipment or a cancellation of `picks` is worth.
 *
 * Units are consumed in index order: a line's next free unit is its
 * `shipped + cancelled` count, which the caller passes in `consumed`. An amount
 * is therefore a sum of fixed per-unit shares rather than a fresh rounding, so
 * no rounding boundary is ever crossed twice, and the parts sum to the recorded
 * whole by construction.
 */
export function shareFor(
  shares: Map<string, UnitLedger[]>,
  consumed: ReadonlyMap<string, number>,
  picks: readonly Pick[],
): UnitLedger {
  if (picks.length === 0) {
    throw new RangeError('Nothing picked');
  }

  let total: Money | null = null;
  let commission: Money | null = null;

  for (const pick of picks) {
    const units = shares.get(pick.orderItemId);
    if (units === undefined) {
      throw new RangeError(`Order item ${pick.orderItemId} is not on this order`);
    }
    if (!Number.isInteger(pick.quantity) || pick.quantity < 1) {
      throw new RangeError(`Picked quantity ${pick.quantity} for ${pick.orderItemId}`);
    }
    const from = consumed.get(pick.orderItemId) ?? 0;
    if (from + pick.quantity > units.length) {
      throw new RangeError(
        `Order item ${pick.orderItemId} has ${units.length - from} units left, picked ${pick.quantity}`,
      );
    }
    for (const unit of units.slice(from, from + pick.quantity)) {
      total = total === null ? unit.total : money(total.amount + unit.total.amount, total.currency);
      commission =
        commission === null
          ? unit.commission
          : money(commission.amount + unit.commission.amount, commission.currency);
    }
  }

  return { total: total as Money, commission: commission as Money };
}

/**
 * Dispatch: the seller's money leaves clearing.
 *
 *     DR  platform_clearing            release
 *     CR  seller_payable:<org>                release - commission
 *     CR  platform_revenue:commission         commission
 *
 * Capture no longer credits SELLER_PAYABLE (see `captureEntries`), so this is
 * where a seller becomes owed anything at all - for exactly the units that left
 * the building, and never before.
 *
 * Zero-amount entries are omitted rather than posted: `ledger_entries` carries
 * CHECK (amount <> 0), because a zero posting is always a bug and never a
 * rounding result.
 */
export function releaseEntries(orgId: string, share: UnitLedger): Entry[] {
  const payable = subtract(share.total, share.commission);
  if (payable.amount < 0) {
    throw new RangeError(
      `Commission ${share.commission.amount} exceeds the ${share.total.amount} released`,
    );
  }

  const entries: Entry[] = [{ kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: share.total }];
  if (payable.amount !== 0) {
    entries.push({
      kind: 'SELLER_PAYABLE',
      ownerOrgId: orgId,
      amount: money(-payable.amount, payable.currency),
    });
  }
  if (share.commission.amount !== 0) {
    entries.push({
      kind: 'PLATFORM_REVENUE_COMMISSION',
      ownerOrgId: null,
      amount: money(-share.commission.amount, share.commission.currency),
    });
  }

  assertBalanced(entries);
  return entries;
}

/**
 * Cancellation: the buyer is owed the cancelled units back.
 *
 *     DR  platform_clearing            cancelled share
 *     CR  buyer_receivable                    cancelled share
 *
 * No seller entry, because a seller was never credited for units that did not
 * dispatch - the dispatch-release decision paying for itself on its first use.
 *
 * Returning the money through the gateway is Phase 8. The ledger says it is
 * owed from the moment it is owed, which is a balance anyone can query rather
 * than a half-built refund path.
 */
export function reversalEntries(share: UnitLedger): Entry[] {
  if (share.total.amount === 0) {
    throw new RangeError('A reversal of zero is always a bug');
  }
  const entries: Entry[] = [
    { kind: 'PLATFORM_CLEARING', ownerOrgId: null, amount: share.total },
    {
      kind: 'BUYER_RECEIVABLE',
      ownerOrgId: null,
      amount: money(-share.total.amount, share.total.currency),
    },
  ];
  assertBalanced(entries);
  return entries;
}
