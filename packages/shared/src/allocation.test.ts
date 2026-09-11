import { describe, expect, it } from 'vitest';
import { allocateStock, splitsAcrossWarehouses } from './allocation.js';
import type { WarehouseStock } from './allocation.js';

function warehouse(
  warehouseId: string,
  priority: number,
  available: Record<string, number>,
): WarehouseStock {
  return { warehouseId, priority, available: new Map(Object.entries(available)) };
}

describe('allocate', () => {
  it('fills everything from the highest-priority warehouse when it can', () => {
    const plan = allocateStock(
      [{ orderItemId: 'a', quantity: 2 }],
      [warehouse('dhaka', 0, { a: 5 }), warehouse('ctg', 1, { a: 5 })],
    );

    expect(plan.allocations).toEqual([{ warehouseId: 'dhaka', picks: [{ orderItemId: 'a', quantity: 2 }] }]);
    expect(plan.unfulfilled).toEqual([]);
    // One warehouse can serve it, so there is one parcel. Splitting a line that
    // did not need splitting costs the seller a second delivery fee.
    expect(splitsAcrossWarehouses(plan)).toBe(false);
  });

  it('SPLITS ONE LINE across two warehouses - the Phase 6 acceptance case', () => {
    // Three units wanted, two in Dhaka and the rest in Chattogram. PRD 11
    // Phase 6: "an order allocates across two warehouses and produces two
    // shipments".
    const plan = allocateStock(
      [{ orderItemId: 'a', quantity: 3 }],
      [warehouse('dhaka', 0, { a: 2 }), warehouse('ctg', 1, { a: 4 })],
    );

    expect(plan.allocations).toEqual([
      { warehouseId: 'dhaka', picks: [{ orderItemId: 'a', quantity: 2 }] },
      { warehouseId: 'ctg', picks: [{ orderItemId: 'a', quantity: 1 }] },
    ]);
    expect(plan.unfulfilled).toEqual([]);
    expect(splitsAcrossWarehouses(plan)).toBe(true);
  });

  it('keeps lines together in one parcel where it can', () => {
    const plan = allocateStock(
      [
        { orderItemId: 'a', quantity: 1 },
        { orderItemId: 'b', quantity: 1 },
      ],
      [warehouse('dhaka', 0, { a: 1, b: 1 }), warehouse('ctg', 1, { a: 9, b: 9 })],
    );

    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0]?.picks).toEqual([
      { orderItemId: 'a', quantity: 1 },
      { orderItemId: 'b', quantity: 1 },
    ]);
  });

  it('reports what nowhere can fill instead of throwing', () => {
    // A seller with a partly-stocked order needs to send what they have and
    // SEE what they cannot. Throwing would make the whole dispatch fail on the
    // one line that came up short.
    const plan = allocateStock(
      [
        { orderItemId: 'a', quantity: 5 },
        { orderItemId: 'b', quantity: 2 },
      ],
      [warehouse('dhaka', 0, { a: 3 })],
    );

    expect(plan.allocations).toEqual([
      { warehouseId: 'dhaka', picks: [{ orderItemId: 'a', quantity: 3 }] },
    ]);
    expect(plan.unfulfilled).toEqual([
      { orderItemId: 'a', quantity: 2 },
      { orderItemId: 'b', quantity: 2 },
    ]);
  });

  it('produces no parcel for a warehouse that contributes nothing', () => {
    // An empty allocation would make the caller create a shipment with no
    // items, which shipment_items' own quantity check then rejects one layer
    // too late.
    const plan = allocateStock(
      [{ orderItemId: 'a', quantity: 1 }],
      [warehouse('dhaka', 0, { a: 1 }), warehouse('empty', 1, { a: 0 }), warehouse('other', 2, {})],
    );

    expect(plan.allocations.map((a) => a.warehouseId)).toEqual(['dhaka']);
  });

  it('is deterministic when priorities tie', () => {
    // Two warehouses at priority 0 must not swap between runs, or the same
    // order splits two ways and no test can pin either. Ties break on id.
    const forwards = allocateStock(
      [{ orderItemId: 'a', quantity: 3 }],
      [warehouse('zulu', 0, { a: 2 }), warehouse('alpha', 0, { a: 2 })],
    );
    const backwards = allocateStock(
      [{ orderItemId: 'a', quantity: 3 }],
      [warehouse('alpha', 0, { a: 2 }), warehouse('zulu', 0, { a: 2 })],
    );

    expect(forwards).toEqual(backwards);
    expect(forwards.allocations[0]?.warehouseId).toBe('alpha');
  });

  it('allocates nothing when the seller has no warehouses', () => {
    const plan = allocateStock([{ orderItemId: 'a', quantity: 2 }], []);
    expect(plan.allocations).toEqual([]);
    expect(plan.unfulfilled).toEqual([{ orderItemId: 'a', quantity: 2 }]);
  });

  it('handles an order with no outstanding lines', () => {
    const plan = allocateStock([], [warehouse('dhaka', 0, { a: 5 })]);
    expect(plan.allocations).toEqual([]);
    expect(plan.unfulfilled).toEqual([]);
    expect(splitsAcrossWarehouses(plan)).toBe(false);
  });

  it('never allocates more than was asked for', () => {
    const plan = allocateStock(
      [{ orderItemId: 'a', quantity: 2 }],
      [warehouse('dhaka', 0, { a: 100 }), warehouse('ctg', 1, { a: 100 })],
    );

    const total = plan.allocations
      .flatMap((a) => a.picks)
      .reduce((sum, pick) => sum + pick.quantity, 0);
    expect(total).toBe(2);
  });

  it('ignores negative stock rather than treating it as a debt', () => {
    const plan = allocateStock(
      [{ orderItemId: 'a', quantity: 1 }],
      [warehouse('broken', 0, { a: -5 }), warehouse('dhaka', 1, { a: 1 })],
    );
    expect(plan.allocations).toEqual([
      { warehouseId: 'dhaka', picks: [{ orderItemId: 'a', quantity: 1 }] },
    ]);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
  ])('refuses a %s quantity', (_name, quantity) => {
    expect(() => allocateStock([{ orderItemId: 'a', quantity }], [])).toThrow(/positive integer/);
  });

  it('refuses the same order item twice', () => {
    // Collapsing them would lose one line's quantity silently, which is an
    // order short-shipped by an amount nobody can see in the plan.
    expect(() =>
      allocateStock(
        [
          { orderItemId: 'a', quantity: 1 },
          { orderItemId: 'a', quantity: 2 },
        ],
        [],
      ),
    ).toThrow(/appears twice/);
  });
});
