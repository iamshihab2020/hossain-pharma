/**
 * The order lifecycle, as a table rather than a pile of `if`s.
 *
 * PRD 9.2 names CONFIRMED -> PACKED -> SHIPPED -> OUT_FOR_DELIVERY -> DELIVERED.
 * This is deliberately not that list:
 *
 *   - PACKED moves no money and no stock, and a buyer cannot tell it from
 *     ACCEPTED. It is a warehouse-workflow state, and there is no warehouse
 *     workflow until Phase 6 gives warehouses an allocation strategy.
 *   - OUT_FOR_DELIVERY is a carrier tracking event. Inventing it now as a
 *     seller-clicked button means Phase 6 arrives to find a hand-set column
 *     competing with a real event feed.
 *   - PARTIALLY_SHIPPED, which Phase 5's acceptance criterion requires, has
 *     nowhere to live in a linear list.
 *   - REJECTED is distinct from CANCELLED because a buyer must be able to tell
 *     "I cancelled this" from "the seller would not fulfil it" without reading
 *     an event log.
 */
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'PARTIALLY_SHIPPED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export type Actor = 'BUYER' | 'SELLER' | 'SYSTEM';

export type LineCoverage = {
  readonly ordered: number;
  readonly shipped: number;
  readonly cancelled: number;
};

export class InvalidTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus, actor: Actor) {
    super(`A ${actor} may not move an order from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * Who may drive what.
 *
 * A pair absent from this table is forbidden - it is a whitelist, so a state
 * added later is closed until someone deliberately opens it. That is the
 * opposite of the failure mode where a new state silently inherits every
 * transition because the check was a negative one.
 */
const TRANSITIONS: Readonly<
  Record<OrderStatus, Readonly<Partial<Record<OrderStatus, readonly Actor[]>>>>
> = {
  PENDING_PAYMENT: {
    // ADR 0018: the webhook is the only writer of payment status. This is that
    // rule's consequence for orders - no human moves an order to PAID.
    PAID: ['SYSTEM'],
    CANCELLED: ['BUYER', 'SELLER'],
  },
  PAID: {
    ACCEPTED: ['SELLER'],
    REJECTED: ['SELLER'],
    CANCELLED: ['BUYER', 'SELLER'],
  },
  ACCEPTED: {
    PARTIALLY_SHIPPED: ['SELLER'],
    SHIPPED: ['SELLER'],
    CANCELLED: ['BUYER', 'SELLER'],
  },
  PARTIALLY_SHIPPED: {
    SHIPPED: ['SELLER'],
    // Deliberately not CANCELLED: goods are already with a courier. A seller
    // cancels the outstanding LINES, which lands the order on SHIPPED - every
    // unit that was ever going to move, moved.
  },
  SHIPPED: {
    DELIVERED: ['SELLER'],
  },
  REJECTED: {},
  DELIVERED: {},
  CANCELLED: {},
};

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export function assertTransition(from: OrderStatus, to: OrderStatus, actor: Actor): void {
  if (!canTransition(from, to, actor)) {
    throw new InvalidTransitionError(from, to, actor);
  }
}

/**
 * What the order's status now is, given what each line has shipped or lost.
 *
 * The status column is never set by hand: a caller ships or cancels, and this
 * decides. That is what keeps `orders.status` from disagreeing with
 * `shipment_items`, since only one of the two can be recomputed from the other.
 */
export function statusFromCoverage(
  lines: readonly LineCoverage[],
  current: OrderStatus,
): OrderStatus {
  if (lines.length === 0) {
    throw new RangeError('An order with no lines has no coverage to compute');
  }

  let shipped = 0;
  let cancelled = 0;
  let ordered = 0;
  for (const line of lines) {
    if (line.shipped + line.cancelled > line.ordered) {
      throw new RangeError(
        `Line covers ${line.shipped + line.cancelled} of ${line.ordered} ordered units`,
      );
    }
    shipped += line.shipped;
    cancelled += line.cancelled;
    ordered += line.ordered;
  }

  // DELIVERED is past the end of this function's authority. Coverage cannot
  // un-deliver an order, and Phase 6's carrier events are what will move it.
  if (current === 'DELIVERED') return 'DELIVERED';
  if (shipped === 0 && cancelled === 0) return current;
  if (shipped === 0 && cancelled === ordered) return 'CANCELLED';
  if (shipped + cancelled === ordered) return 'SHIPPED';
  return 'PARTIALLY_SHIPPED';
}
