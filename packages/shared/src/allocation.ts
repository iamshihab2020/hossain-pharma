/**
 * Multi-warehouse allocation: which units leave which building.
 *
 * PRD 11 Phase 6's acceptance criterion is "an order allocates across two
 * warehouses and produces two shipments". This is the half of that which is
 * arithmetic; `FulfilmentService` turns each plan below into a real parcel.
 *
 * Pure, like `fulfilment.ts` beside it, because the interesting cases here are
 * combinatorial rather than transactional: a line that splits, a line that
 * cannot be filled at all, two warehouses that tie. Proving those against a
 * seeded database would need a fixture per case.
 *
 * NAMED `allocateStock`, not `allocate`, because `money.ts` already exports an
 * `allocate` that splits one amount across parts without losing a unit. Both
 * are re-exported from the package index, so a shared name is not a style
 * question - the second export silently shadows the first, and the first caller
 * to want money-splitting gets warehouse arithmetic with no error. It happened
 * exactly once, here, before this comment existed.
 */

export type AllocationRequest = {
  readonly orderItemId: string;
  /** Units still outstanding on this line - ordered minus shipped minus cancelled. */
  readonly quantity: number;
};

export type WarehouseStock = {
  readonly warehouseId: string;
  /** `warehouses.priority`, lowest first. */
  readonly priority: number;
  /** Available units of each order item AT THIS WAREHOUSE, keyed by orderItemId. */
  readonly available: ReadonlyMap<string, number>;
};

export type AllocationPick = {
  readonly orderItemId: string;
  readonly quantity: number;
};

export type WarehouseAllocation = {
  readonly warehouseId: string;
  readonly picks: readonly AllocationPick[];
};

export type AllocationPlan = {
  readonly allocations: readonly WarehouseAllocation[];
  /**
   * What could not be filled anywhere, per line.
   *
   * Returned rather than thrown. A seller with a partly-stocked order needs to
   * dispatch what they have and see what they cannot - and `FulfilmentService`
   * has to decide whether a short allocation is a partial shipment or a refusal,
   * which is a policy question this function has no business answering.
   */
  readonly unfulfilled: readonly AllocationPick[];
};

/**
 * Greedy, in warehouse priority order.
 *
 * DETERMINISTIC IS THE REQUIREMENT, not optimal. A cleverer strategy - fewest
 * parcels, nearest warehouse, cheapest combined rate - would pick differently as
 * stock moved underneath it, and the same order would split two ways on two
 * runs with no test able to pin either. The seller sets `priority` and ties
 * break on `warehouseId`, so the sort is total and the plan is reproducible.
 *
 * Fewest-parcels IS worth wanting, and priority order approximates it for free
 * whenever the seller ranks their main warehouse first, which is what a seller
 * does. Making it an explicit objective is a Phase 10 concern, alongside the
 * delivery-performance analytics that would show whether it paid.
 */
export function allocateStock(
  lines: readonly AllocationRequest[],
  stock: readonly WarehouseStock[],
): AllocationPlan {
  /**
   * Built one line at a time so a REPEATED order item is caught rather than
   * quietly collapsed.
   *
   * `new Map(lines.map(...))` keeps the last of a duplicated pair and silently
   * loses the first, which would under-allocate an order by exactly the
   * quantity nobody noticed. An order item appearing twice is a caller bug, and
   * this is where it is cheapest to see.
   */
  const outstanding = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError(
        `Line ${line.orderItemId} needs a positive integer quantity, got ${String(line.quantity)}`,
      );
    }
    if (outstanding.has(line.orderItemId)) {
      throw new RangeError(`Order item ${line.orderItemId} appears twice in one allocation`);
    }
    outstanding.set(line.orderItemId, line.quantity);
  }

  const ordered = [...stock].sort(
    (a, b) => a.priority - b.priority || a.warehouseId.localeCompare(b.warehouseId),
  );

  const allocations: WarehouseAllocation[] = [];

  for (const warehouse of ordered) {
    const picks: AllocationPick[] = [];

    /**
     * Over the MAP, which iterates in insertion order - that is specified
     * behaviour, not an accident - so picks come out in the order the lines
     * arrived. Iterating `lines` instead would need a `?? 0` on every lookup
     * for a key that cannot be missing, which is an unreachable branch pretending
     * to be a safety net.
     */
    for (const [orderItemId, need] of outstanding) {
      if (need === 0) continue;

      const here = warehouse.available.get(orderItemId) ?? 0;
      if (here <= 0) continue;

      const take = Math.min(need, here);
      picks.push({ orderItemId, quantity: take });
      outstanding.set(orderItemId, need - take);
    }

    // A warehouse that contributes nothing produces no parcel. Emitting an
    // empty allocation would make the caller create a shipment with no items,
    // which `shipment_items`' own quantity check would then reject one layer
    // too late.
    if (picks.length > 0) allocations.push({ warehouseId: warehouse.warehouseId, picks });
  }

  const unfulfilled: AllocationPick[] = [];
  for (const [orderItemId, left] of outstanding) {
    if (left > 0) unfulfilled.push({ orderItemId, quantity: left });
  }

  return { allocations, unfulfilled };
}

/**
 * True when the plan needs more than one parcel.
 *
 * A named predicate rather than `plan.allocations.length > 1` at each call site,
 * because "this order splits" is a thing the seller console says out loud and
 * the phrase should mean one thing everywhere.
 */
export function splitsAcrossWarehouses(plan: AllocationPlan): boolean {
  return plan.allocations.length > 1;
}
