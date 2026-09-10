# Phase 5 — Orders & Fulfilment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An order placed in Phase 4 can be accepted, shipped in parts, delivered
and cancelled — with the seller's money released per shipment and the buyer able
to watch it happen.

**Architecture:** Shipments are first-class rows; `orders.status` is computed from
line coverage by one writer; the buyer's timeline is an append-only event table.
A seller's payable moves out of `PLATFORM_CLEARING` on dispatch rather than at
capture, allocated per unit so the parts sum to the recorded whole.

**Tech Stack:** NestJS 11 on Fastify (ESM, `.js` import extensions), Drizzle +
Postgres RLS, Next.js 16 App Router, Vitest + Testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-10-phase-5-orders-and-fulfilment-design.md`
— read it first. This plan argues from it and does not repeat its reasoning.

---

## Global Constraints

Unchanged from Phase 4, repeated because they are what breaks silently:

- **Never import `db` or `pool` from `@nexmarket/db`.** Use `withTenant`, or take
  the transaction from `getRequestContext().tx`. A lint rule enforces this.
- **New tenant-owned tables need `ENABLE` + `FORCE` + policies** in a hand-written
  migration created with `drizzle-kit generate --custom`. A hand-dropped `.sql`
  is silently ignored — it must be in `migrations/meta/_journal.json`.
- **Every gated policy carries `NULLIF(current_setting('app.tenant_id', true), '') IS NULL`.**
  Postgres ORs permissive policies. This has bitten three times; this phase adds
  three more chances.
- **Missing tenant context returns zero rows, never all rows.** Keep the
  `NULLIF(...)::uuid` wrapper — without it a null tenant raises
  `invalid input syntax for type uuid`.
- **A write that changes what a buyer would FIND must reindex.** Cancellation
  does; dispatch does not (§6 of the spec).
- **`listings.available_stock` has one writer**: `ListingsService.recomputeAvailableStock`.
- Money is integer minor units, `bigint` + `char(3)`. No floats in any path.
- **Never mutate seeded users or organisations in a test.** Register your own.
- **Namespace test emails and slugs per file** — this phase uses `fulfilment-`,
  `shipment-`, `cancel-`.
- All relative imports carry `.js` extensions. `exactOptionalPropertyTypes` is on
  everywhere except `apps/web`.
- Four gates must pass: `pnpm lint && pnpm type-check && pnpm test && pnpm build`.
- **Every commit message ends with:**
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `packages/shared/src/order-state.ts` | The transition table and status-from-coverage. Pure. 100 % |
| `packages/shared/src/fulfilment.ts` | Per-unit allocation of an order total; release and reversal entry builders. Pure. 100 % |
| `packages/db/src/schema/fulfilment.ts` | `shipments`, `shipment_items`, `order_events` |
| `packages/db/migrations/0013_fulfilment_tables.sql` | Tables, enum extensions, `cancelled_quantity` |
| `packages/db/migrations/0014_fulfilment_rls.sql` | RLS, revokes, over-shipment constraint trigger |
| `packages/db/src/fulfilment-rls.test.ts` | Policy tests, mutation-verified |
| `packages/db/src/fulfilment-constraints.test.ts` | Append-only + over-shipment trigger |
| `apps/api/src/modules/fulfilment/*` | Service, controllers, DTOs, module |
| `apps/api/test/fulfilment.e2e.test.ts` | The two PRD acceptance criteria and the demo |
| `apps/web/app/seller/orders/*` | The seller queue |
| `apps/web/components/order-timeline.tsx` | Buyer timeline |
| `docs/architecture/0019-buyer-cancellation-and-the-fourth-escape.md` | |
| `docs/architecture/0020-dispatch-release-and-per-unit-allocation.md` | |

**Modified:** `packages/shared/src/ledger.ts` (capture), `payment-webhook.service.ts`,
`packages/db/src/schema/orders.ts`, `apps/api/src/modules/orders/*`,
`apps/api/src/common/tenant-scope.ts`, `packages/api-client/src/schemas.ts`,
`apps/api/test/contract.e2e.test.ts`, `apps/web/app/orders/[id]/page.tsx`,
`CLAUDE.md`, `docs/SYSTEM-DESIGN.md`, `docs/DESIGN-DIRECTION.md`.

**Interfaces every later task depends on** (defined in Tasks 1–2, repeated here
so no task has to guess):

```ts
// @nexmarket/shared — order-state.ts
export type OrderStatus =
  | 'PENDING_PAYMENT' | 'PAID' | 'ACCEPTED' | 'REJECTED'
  | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
export type Actor = 'BUYER' | 'SELLER' | 'SYSTEM';
export type LineCoverage = { readonly ordered: number; readonly shipped: number; readonly cancelled: number };
export class InvalidTransitionError extends Error {}
export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean;
export function assertTransition(from: OrderStatus, to: OrderStatus, actor: Actor): void;
export function statusFromCoverage(lines: readonly LineCoverage[], current: OrderStatus): OrderStatus;

// @nexmarket/shared — fulfilment.ts
export type OrderLine = { readonly orderItemId: string; readonly quantity: number; readonly unitPriceAmount: number };
export type Pick = { readonly orderItemId: string; readonly quantity: number };
export type UnitLedger = { readonly total: Money; readonly commission: Money };
export function unitShares(orderTotal: Money, orderCommission: Money, lines: readonly OrderLine[]): Map<string, UnitLedger[]>;
export function shareFor(shares: Map<string, UnitLedger[]>, consumed: ReadonlyMap<string, number>, picks: readonly Pick[]): UnitLedger;
export function releaseEntries(orgId: string, share: UnitLedger): Entry[];
export function reversalEntries(share: UnitLedger): Entry[];
```

---

## Task 1: The transition table

**Files:**
- Create: `packages/shared/src/order-state.ts`
- Create: `packages/shared/src/order-state.test.ts`
- Modify: `packages/shared/src/index.ts` (export), `packages/shared/vitest.config.ts` (coverage include list)

**Interfaces:**
- Consumes: nothing
- Produces: `OrderStatus`, `Actor`, `LineCoverage`, `canTransition`, `assertTransition`, `statusFromCoverage`, `InvalidTransitionError` — signatures above

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/order-state.test.ts
import { describe, expect, it } from 'vitest';
import {
  assertTransition, canTransition, InvalidTransitionError, statusFromCoverage,
} from './order-state.js';

const line = (ordered: number, shipped = 0, cancelled = 0) => ({ ordered, shipped, cancelled });

describe('canTransition', () => {
  it('lets a seller accept a paid order', () => {
    expect(canTransition('PAID', 'ACCEPTED', 'SELLER')).toBe(true);
  });

  it('does not let a buyer accept their own order', () => {
    expect(canTransition('PAID', 'ACCEPTED', 'BUYER')).toBe(false);
  });

  it('does not let a seller accept an order twice', () => {
    expect(canTransition('ACCEPTED', 'ACCEPTED', 'SELLER')).toBe(false);
  });

  it('refuses every transition out of a terminal state', () => {
    for (const terminal of ['DELIVERED', 'CANCELLED', 'REJECTED'] as const) {
      for (const to of ['ACCEPTED', 'SHIPPED', 'CANCELLED'] as const) {
        expect(canTransition(terminal, to, 'SELLER')).toBe(false);
      }
    }
  });

  it('lets a buyer cancel only before anything dispatches', () => {
    expect(canTransition('PAID', 'CANCELLED', 'BUYER')).toBe(true);
    expect(canTransition('ACCEPTED', 'CANCELLED', 'BUYER')).toBe(true);
    expect(canTransition('PARTIALLY_SHIPPED', 'CANCELLED', 'BUYER')).toBe(false);
  });

  it('reserves PAID for the webhook', () => {
    expect(canTransition('PENDING_PAYMENT', 'PAID', 'SYSTEM')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'PAID', 'SELLER')).toBe(false);
  });
});

describe('assertTransition', () => {
  it('throws InvalidTransitionError naming both states', () => {
    expect(() => assertTransition('DELIVERED', 'ACCEPTED', 'SELLER')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('DELIVERED', 'ACCEPTED', 'SELLER')).toThrow(/DELIVERED.*ACCEPTED/);
  });

  it('returns silently on a legal transition', () => {
    expect(() => assertTransition('PAID', 'ACCEPTED', 'SELLER')).not.toThrow();
  });
});

describe('statusFromCoverage', () => {
  it('leaves an untouched order alone', () => {
    expect(statusFromCoverage([line(3)], 'ACCEPTED')).toBe('ACCEPTED');
  });

  it('is PARTIALLY_SHIPPED while units remain outstanding', () => {
    expect(statusFromCoverage([line(3, 1)], 'ACCEPTED')).toBe('PARTIALLY_SHIPPED');
  });

  it('is PARTIALLY_SHIPPED when one line of two is complete', () => {
    expect(statusFromCoverage([line(1, 1), line(2)], 'ACCEPTED')).toBe('PARTIALLY_SHIPPED');
  });

  it('is SHIPPED when every unit shipped', () => {
    expect(statusFromCoverage([line(2, 2), line(1, 1)], 'PARTIALLY_SHIPPED')).toBe('SHIPPED');
  });

  it('is SHIPPED when the outstanding remainder was cancelled', () => {
    expect(statusFromCoverage([line(3, 1, 2)], 'PARTIALLY_SHIPPED')).toBe('SHIPPED');
  });

  it('is CANCELLED when every unit was cancelled and none shipped', () => {
    expect(statusFromCoverage([line(2, 0, 2)], 'ACCEPTED')).toBe('CANCELLED');
  });

  it('never walks a DELIVERED order backwards', () => {
    expect(statusFromCoverage([line(1, 1)], 'DELIVERED')).toBe('DELIVERED');
  });

  it('rejects coverage that exceeds what was ordered', () => {
    expect(() => statusFromCoverage([line(1, 1, 1)], 'ACCEPTED')).toThrow(RangeError);
  });

  it('rejects an empty order', () => {
    expect(() => statusFromCoverage([], 'PAID')).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

`pnpm --filter @nexmarket/shared exec vitest run order-state`
Expected: FAIL — cannot resolve `./order-state.js`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/order-state.ts
/**
 * The order lifecycle, as a table rather than a pile of `if`s.
 *
 * PRD 9.2 names CONFIRMED -> PACKED -> SHIPPED -> OUT_FOR_DELIVERY -> DELIVERED.
 * This is deliberately not that list: PACKED moves no money and no stock and a
 * buyer cannot tell it from ACCEPTED, OUT_FOR_DELIVERY is a carrier event that
 * belongs to Phase 6, and PARTIALLY_SHIPPED - which the acceptance criterion
 * requires - has nowhere to live in a linear list. See the Phase 5 design, 2.2.
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
 * Who may drive what. An entry absent from this table is forbidden - the table
 * is a whitelist, so a state added later is closed until someone opens it.
 */
const TRANSITIONS: Readonly<Record<OrderStatus, Readonly<Partial<Record<OrderStatus, readonly Actor[]>>>>> = {
  PENDING_PAYMENT: {
    // ADR 0018: the webhook is the only writer of payment status, and this is
    // its consequence for orders.
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
    // Not CANCELLED: goods are already with a courier. The seller cancels the
    // outstanding LINES, which lands the order on SHIPPED.
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
 * decides. That is what keeps `orders.status` and `shipment_items` from
 * disagreeing, since only one of them can be recomputed.
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
  // un-deliver an order, and Phase 6's carrier events are what move it.
  if (current === 'DELIVERED') return 'DELIVERED';
  if (shipped === 0 && cancelled === 0) return current;
  if (shipped === 0 && cancelled === ordered) return 'CANCELLED';
  if (shipped + cancelled === ordered) return 'SHIPPED';
  return 'PARTIALLY_SHIPPED';
}
```

- [ ] **Step 4: Export it and add it to the coverage list**

In `packages/shared/src/index.ts` add `export * from './order-state.js';`.
In `packages/shared/vitest.config.ts`, add `'src/order-state.ts'` to the same
`include` list that carries `money.ts`, `capabilities.ts` and `buy-box.ts`.

- [ ] **Step 5: Run with coverage**

`pnpm --filter @nexmarket/shared test`
Expected: PASS, and 100 % on `order-state.ts`. If a branch is uncovered, add the
test — never lower the threshold.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/order-state.ts packages/shared/src/order-state.test.ts \
        packages/shared/src/index.ts packages/shared/vitest.config.ts
git commit -m "feat(shared): the order transition table, as data"
```

---

## Task 2: Per-unit allocation and the fulfilment entries

**Files:**
- Create: `packages/shared/src/fulfilment.ts`, `packages/shared/src/fulfilment.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/vitest.config.ts`

**Interfaces:**
- Consumes: `Money`, `money`, `allocate`, `subtract` from `money.ts`; `Entry`, `assertBalanced` from `ledger.ts`
- Produces: `unitShares`, `shareFor`, `releaseEntries`, `reversalEntries`, `OrderLine`, `Pick`, `UnitLedger`

- [ ] **Step 1: Write the failing tests**

The first test is the whole reason this module exists — it is the rounding case
from §5.3 of the spec, and it fails against any implementation that recomputes a
percentage per shipment.

```ts
// packages/shared/src/fulfilment.test.ts
import { describe, expect, it } from 'vitest';
import { money } from './money.js';
import { assertBalanced } from './ledger.js';
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
    // unit 1, qty 3, commission 5000 bps: commissionFor rounds 1.5 up to 2,
    // while three per-unit roundings of 0.5 would each round up, to 3.
    const shares = unitShares(money(3, BDT), money(2, BDT), [
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
    // total exceeds the sum of the lines: 200 of goods, 50 of shipping and tax.
    const shares = unitShares(money(250, BDT), money(10, BDT), [
      { orderItemId: 'a', quantity: 2, unitPriceAmount: 100 },
    ]);
    const units = shares.get('a') ?? [];
    expect(units.reduce((n, u) => n + u.total.amount, 0)).toBe(250);
  });

  it('rejects an order with no lines', () => {
    expect(() => unitShares(money(1, BDT), money(0, BDT), [])).toThrow(RangeError);
  });

  it('rejects a mixed-currency order', () => {
    expect(() =>
      unitShares(money(100, BDT), money(5, 'USD'), [
        { orderItemId: 'a', quantity: 1, unitPriceAmount: 100 },
      ]),
    ).toThrow(RangeError);
  });
});

describe('shareFor', () => {
  const shares = unitShares(money(300, BDT), money(15, BDT), [
    { orderItemId: 'a', quantity: 3, unitPriceAmount: 100 },
  ]);

  it('takes units in index order from what is unconsumed', () => {
    const first = shareFor(shares, consumedNone, [{ orderItemId: 'a', quantity: 2 }]);
    const second = shareFor(shares, new Map([['a', 2]]), [{ orderItemId: 'a', quantity: 1 }]);
    expect(first.total.amount + second.total.amount).toBe(300);
    expect(first.commission.amount + second.commission.amount).toBe(15);
  });

  it('refuses to consume more units than remain', () => {
    expect(() => shareFor(shares, new Map([['a', 2]]), [{ orderItemId: 'a', quantity: 2 }]))
      .toThrow(RangeError);
  });

  it('refuses a line the order does not have', () => {
    expect(() => shareFor(shares, consumedNone, [{ orderItemId: 'zz', quantity: 1 }]))
      .toThrow(RangeError);
  });

  it('refuses a non-positive quantity', () => {
    expect(() => shareFor(shares, consumedNone, [{ orderItemId: 'a', quantity: 0 }]))
      .toThrow(RangeError);
  });
});

describe('releaseEntries', () => {
  it('moves clearing to payable and commission, and balances', () => {
    const entries = releaseEntries('org-1', { total: money(100, BDT), commission: money(10, BDT) });
    expect(() => assertBalanced(entries)).not.toThrow();
    expect(entries.find((e) => e.kind === 'SELLER_PAYABLE')?.amount.amount).toBe(-90);
    expect(entries.find((e) => e.kind === 'PLATFORM_REVENUE_COMMISSION')?.amount.amount).toBe(-10);
  });

  it('omits a zero commission rather than posting a zero entry', () => {
    const entries = releaseEntries('org-1', { total: money(100, BDT), commission: money(0, BDT) });
    expect(entries.some((e) => e.kind === 'PLATFORM_REVENUE_COMMISSION')).toBe(false);
    expect(() => assertBalanced(entries)).not.toThrow();
  });

  it('refuses a commission larger than the amount released', () => {
    expect(() => releaseEntries('org-1', { total: money(10, BDT), commission: money(11, BDT) }))
      .toThrow(RangeError);
  });
});

describe('reversalEntries', () => {
  it('returns the buyer receivable and balances', () => {
    const entries = reversalEntries({ total: money(100, BDT), commission: money(10, BDT) });
    expect(() => assertBalanced(entries)).not.toThrow();
    expect(entries.find((e) => e.kind === 'BUYER_RECEIVABLE')?.amount.amount).toBe(-100);
  });

  it('refuses a zero reversal', () => {
    expect(() => reversalEntries({ total: money(0, BDT), commission: money(0, BDT) }))
      .toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

`pnpm --filter @nexmarket/shared exec vitest run fulfilment`
Expected: FAIL — cannot resolve `./fulfilment.js`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/fulfilment.ts
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
 * `gross` in a capture is `order.total` - subtotal PLUS order-level shipping and
 * tax - so a shipment carrying some units is an amount computed at order level
 * and then split. That is exactly what `allocate` exists for, and Phase 4's plan
 * (F-1) predicted it would land at a promotion or a partial refund. A partial
 * shipment got there first.
 *
 * Recomputing a shipment's share as a fresh percentage of what it carries is the
 * alternative, and it is wrong in a way nothing catches: with unit price 1,
 * quantity 3 and 5000 bps, the order records commission 2 while three per-unit
 * roundings produce 3. The entries still balance. The number is still wrong.
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
 * `shipped + cancelled` count, which the caller passes in `consumed`. The
 * amount is therefore a sum of fixed per-unit shares rather than a fresh
 * rounding, and it is recomputable from persisted state.
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
 * Capture no longer credits SELLER_PAYABLE (see ledger.ts), so this is where a
 * seller becomes owed anything at all - for exactly the units that left the
 * building, and never before.
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
 * No seller entry, because a seller was never credited for units that did not
 * dispatch. Returning the money through the gateway is Phase 8; the ledger says
 * it is owed from the moment it is owed.
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
```

- [ ] **Step 4: Export and add to coverage**

`export * from './fulfilment.js';` in `index.ts`; `'src/fulfilment.ts'` in the
vitest coverage `include`.

- [ ] **Step 5: Run with coverage**

`pnpm --filter @nexmarket/shared test` — PASS at 100 % on `fulfilment.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/fulfilment.ts packages/shared/src/fulfilment.test.ts \
        packages/shared/src/index.ts packages/shared/vitest.config.ts
git commit -m "feat(shared): per-unit allocation and the fulfilment postings"
```

---

## Task 3: Capture stops paying sellers

**Files:**
- Modify: `packages/shared/src/ledger.ts`, `packages/shared/src/ledger.test.ts`
- Modify: `apps/api/src/modules/payments/payment-webhook.service.ts:160-172`
- Modify: `apps/api/test/ledger.e2e.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–2
- Produces: `captureEntries(total: Money): Entry[]` — the `SellerSplit[]` parameter is gone. `SellerSplit` is deleted.

- [ ] **Step 1: Change the test first**

In `packages/shared/src/ledger.test.ts`, replace every `captureEntries(splits)`
case with:

```ts
describe('captureEntries', () => {
  it('parks the whole payment in clearing and balances', () => {
    const entries = captureEntries(money(1000, 'BDT'));
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.kind === 'BUYER_RECEIVABLE')?.amount.amount).toBe(1000);
    expect(entries.find((e) => e.kind === 'PLATFORM_CLEARING')?.amount.amount).toBe(-1000);
    expect(() => assertBalanced(entries)).not.toThrow();
  });

  it('credits no seller, because nothing has shipped', () => {
    const entries = captureEntries(money(1000, 'BDT'));
    expect(entries.some((e) => e.kind === 'SELLER_PAYABLE')).toBe(false);
    expect(entries.some((e) => e.kind === 'PLATFORM_REVENUE_COMMISSION')).toBe(false);
  });

  it('refuses a zero capture', () => {
    expect(() => captureEntries(money(0, 'BDT'))).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

`pnpm --filter @nexmarket/shared exec vitest run ledger`
Expected: FAIL — `captureEntries` still expects an array.

- [ ] **Step 3: Rewrite `captureEntries`**

```ts
/**
 * A capture, after Phase 5: the buyer owes, and the money lands in clearing.
 *
 *     DR  buyer_receivable          1000
 *     CR  platform_clearing               1000
 *
 * It used to credit each seller's payable here. It does not any more, and the
 * reason is the one clearing was always for - "money received but not yet
 * attributed". Dispatch is the attribution (see fulfilment.ts). A seller who has
 * not shipped is not owed, and a ledger that said otherwise was overstating
 * every payable between capture and dispatch.
 *
 * This also makes card and COD identical from here on: COD_ACCRUAL already
 * posted only a receivable and a clearing credit, so both methods now leave the
 * seller's gross in the same place and release it through the same code path.
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
```

Delete the `SellerSplit` type and its export from `index.ts`.

- [ ] **Step 4: Update the webhook**

In `payment-webhook.service.ts`, the `splits` array and its `map` go. The
capture becomes:

```ts
const total = orders.reduce((sum, order) => sum + order.total, 0);
await this.ledger.post(tx, {
  paymentIntentId: intent.id,
  kind: 'CAPTURE',
  entries: captureEntries(money(total, intent.currency)),
});
```

Remove the now-unused `SellerSplit` import.

- [ ] **Step 5: Update the ledger e2e expectations**

In `apps/api/test/ledger.e2e.test.ts`, any assertion that a seller's payable is
non-zero **after capture** now expects zero, and gets a comment saying why:
`// Phase 5: a payable is created by dispatch, not by capture.` Assertions about
balance, about the transaction row, and about append-only privileges are
unchanged.

- [ ] **Step 6: Run both suites**

```bash
pnpm --filter @nexmarket/shared test
pnpm --filter @nexmarket/api exec vitest run ledger
```
Expected: PASS. `checkout.e2e` must also still pass — run it now, because it
asserts ledger balance after checkout: `pnpm --filter @nexmarket/api exec vitest run checkout`.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ledger.ts packages/shared/src/ledger.test.ts \
        packages/shared/src/index.ts apps/api/src/modules/payments/payment-webhook.service.ts \
        apps/api/test/ledger.e2e.test.ts
git commit -m "refactor(ledger): capture parks money in clearing; dispatch attributes it"
```

---

## Task 4: Schema and migration 0013

**Files:**
- Create: `packages/db/src/schema/fulfilment.ts`
- Modify: `packages/db/src/schema/orders.ts` (enum values, `cancelled_quantity`), `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0013_fulfilment_tables.sql` (via `drizzle-kit generate --custom`)

**Interfaces:**
- Produces: `schema.shipments`, `schema.shipmentItems`, `schema.orderEvents`, `schema.orderItems.cancelledQuantity`, the extended `orderStatus` enum

- [ ] **Step 1: Extend the order status enum and add the column**

In `packages/db/src/schema/orders.ts`:

```ts
export const orderStatus = pgEnum('order_status', [
  'PENDING_PAYMENT',
  'PAID',
  'ACCEPTED',
  'REJECTED',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
]);
```

Replace the Phase 4 comment above it — the states are no longer absent — with a
pointer to `order-state.ts`, which is now where the lifecycle is defined.

In `orderItems`, after `quantity`:

```ts
    /**
     * Cancelled units. Stored rather than derived, because unlike shipped
     * quantity there is no child table to sum - a cancellation is a fact about
     * a line, not an object. One writer: FulfilmentService.
     */
    cancelledQuantity: integer('cancelled_quantity').notNull().default(0),
```

and in the table's constraint list:

```ts
    check('order_items_cancelled_within_ordered',
      sql`${t.cancelledQuantity} >= 0 AND ${t.cancelledQuantity} <= ${t.quantity}`),
```

- [ ] **Step 2: Write the new tables**

```ts
// packages/db/src/schema/fulfilment.ts
import {
  bigint, char, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { orders, orderItems } from './orders.js';
import { users } from './users.js';

export const shipmentStatus = pgEnum('shipment_status', ['DISPATCHED', 'DELIVERED']);

export const orderEventType = pgEnum('order_event_type', [
  'PLACED', 'PAID', 'ACCEPTED', 'REJECTED',
  'SHIPMENT_DISPATCHED', 'SHIPMENT_DELIVERED', 'LINES_CANCELLED', 'CANCELLED',
]);

export const orderEventActor = pgEnum('order_event_actor', ['BUYER', 'SELLER', 'SYSTEM']);

/**
 * A parcel. Creating one IS the dispatch - there is no DRAFT state, because a
 * state whose only function is to be left behind is a state every query has to
 * remember to exclude.
 */
export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => organisations.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    shipmentNumber: text('shipment_number').notNull(),
    status: shipmentStatus('status').notNull().default('DISPATCHED'),

    /** Nullable: a seller may hand a parcel to a rider with neither. */
    carrierName: text('carrier_name'),
    trackingNumber: text('tracking_number'),

    /**
     * What this shipment POSTED. Stored, not recomputed on read: the entries it
     * produced are append-only, so a column that could disagree with them after
     * a rounding change would make the books arguable.
     */
    releaseAmount: bigint('release_amount', { mode: 'number' }).notNull(),
    releaseCommission: bigint('release_commission', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),

    /** The Phase 4 pattern: idempotency is a unique constraint, never a lookup. */
    idempotencyKey: text('idempotency_key').notNull(),

    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('shipments_number_key').on(t.shipmentNumber),
    unique('shipments_idempotency_key').on(t.idempotencyKey),
    check('shipments_release_non_negative', sql`${t.releaseAmount} >= 0 AND ${t.releaseCommission} >= 0`),
    index('shipments_tenant_idx').on(t.tenantId),
    index('shipments_order_idx').on(t.orderId),
  ],
);

export const shipmentItems = pgTable(
  'shipment_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Denormalised so RLS governs this table without joining two levels up. */
    tenantId: uuid('tenant_id').notNull().references(() => organisations.id, { onDelete: 'restrict' }),
    shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
    orderItemId: uuid('order_item_id').notNull().references(() => orderItems.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    check('shipment_items_quantity_positive', sql`${t.quantity} > 0`),
    index('shipment_items_tenant_idx').on(t.tenantId),
    index('shipment_items_shipment_idx').on(t.shipmentId),
    index('shipment_items_order_item_idx').on(t.orderItemId),
  ],
);

/**
 * The buyer's timeline. Append-only - see migration 0014's REVOKE, which is what
 * actually makes it so; the GRANT in 0001 already handed out all four verbs.
 */
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => organisations.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    /**
     * Denormalised so the buyer's policy is a column comparison rather than an
     * EXISTS through orders. This table is read on every timeline render.
     */
    buyerUserId: uuid('buyer_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),

    type: orderEventType('type').notNull(),
    actor: orderEventActor('actor').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Shipment id, carrier, cancelled quantities, rejection reason. */
    payload: jsonb('payload').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('order_events_tenant_idx').on(t.tenantId),
    index('order_events_order_created_idx').on(t.orderId, t.createdAt, t.id),
    index('order_events_buyer_idx').on(t.buyerUserId),
  ],
);
```

Export it from `packages/db/src/schema/index.ts`.

- [ ] **Step 3: Generate the migration**

```bash
pnpm --filter @nexmarket/db exec drizzle-kit generate --custom --name=fulfilment_tables
```

This writes the `.sql`, the journal entry and the snapshot together. Fill the
file with the `CREATE TYPE` / `CREATE TABLE` / `ALTER TABLE` statements, each
separated by `--> statement-breakpoint`, matching `0011_commerce_tables.sql`.
The enum extensions:

```sql
-- ALTER TYPE ... ADD VALUE is allowed inside a transaction on PG 12+, but the
-- new value CANNOT BE USED in the same transaction that adds it. Nothing in
-- this file references them; the first use is in application code, later.
ALTER TYPE "public"."order_status" ADD VALUE 'ACCEPTED';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'REJECTED';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'PARTIALLY_SHIPPED';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'SHIPPED';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'DELIVERED';--> statement-breakpoint
ALTER TYPE "public"."transaction_kind" ADD VALUE 'FULFILMENT';--> statement-breakpoint
```

`transaction_kind` already carries `REFUND`, which cancellation uses. ADR 0016
said refunds would need no schema change; this is where that is confirmed.

- [ ] **Step 4: Apply and verify**

```bash
docker compose up -d
pnpm db:push
```

Then confirm the enum took, and that the new tables exist with RLS **not yet**
enabled (0014 does that):

```bash
docker compose exec -T postgres psql -U postgres -d nexmarket -c \
  "SELECT unnest(enum_range(NULL::order_status));"
docker compose exec -T postgres psql -U postgres -d nexmarket -c \
  "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('shipments','shipment_items','order_events');"
```
Expected: eight statuses; three tables with `relrowsecurity = f`.

- [ ] **Step 5: Widen the ledger's kind union**

`LedgerService.post` types `kind` as `'CAPTURE' | 'REFUND' | 'COD_ACCRUAL'`
(`ledger.service.ts:44`). Add `'FULFILMENT'`, or Task 7 will not compile.

- [ ] **Step 6: Type-check and commit**

```bash
pnpm type-check
git add packages/db/src/schema packages/db/migrations
git commit -m "feat(db): shipments, shipment items and the order event log"
```

---

## Task 5: RLS, append-only, and the over-shipment trigger

**Files:**
- Create: `packages/db/migrations/0014_fulfilment_rls.sql` (via `--custom`)
- Create: `packages/db/src/fulfilment-rls.test.ts`, `packages/db/src/fulfilment-constraints.test.ts`

**Interfaces:**
- Consumes: the tables from Task 4
- Produces: policies `tenant_isolation`, `platform_admin_bypass`, `own_shipments`, `own_shipment_items`, `own_order_events`; trigger `shipment_items_within_ordered`

- [ ] **Step 1: Write the failing RLS tests**

Model them on `packages/db/src/orders-rls.test.ts`. The four that matter:

```ts
// packages/db/src/fulfilment-rls.test.ts (shape; fixtures follow orders-rls.test.ts)
it('shows a seller only their own shipments', async () => {
  const rows = await withTenant({ tenantId: sellerA, userId: null, isAdmin: false },
    (tx) => tx.select().from(schema.shipments));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.tenantId).toBe(sellerA);
});

it('does NOT widen a seller read with the buyer policy', async () => {
  // The mutation check: delete the IS NULL gate from own_shipments and this
  // becomes 2. That is the bug from migrations 0006, 0008 and 0012.
  const rows = await withTenant({ tenantId: sellerA, userId: buyerId, isAdmin: false },
    (tx) => tx.select().from(schema.shipments));
  expect(rows).toHaveLength(1);
});

it('shows a buyer their shipments across every seller', async () => {
  const rows = await withTenant({ tenantId: null, userId: buyerId, isAdmin: false },
    (tx) => tx.select().from(schema.shipments));
  expect(rows).toHaveLength(2);
});

it('returns ZERO rows with no context at all', async () => {
  const rows = await withTenant({ tenantId: null, userId: null, isAdmin: false },
    (tx) => tx.select().from(schema.shipments));
  expect(rows).toHaveLength(0);
});

it('does not let a buyer insert a shipment', async () => {
  await expect(
    withTenant({ tenantId: null, userId: buyerId, isAdmin: false },
      (tx) => tx.insert(schema.shipments).values(/* ... */)),
  ).rejects.toThrow();
});
```

Repeat all five for `shipment_items` and `order_events`.

- [ ] **Step 2: Write the failing constraint tests**

```ts
// packages/db/src/fulfilment-constraints.test.ts
it('refuses UPDATE on order_events', async () => {
  await expect(
    withTenant(ctx, (tx) => tx.execute(sql`UPDATE order_events SET type = 'PAID'`)),
  ).rejects.toMatchObject({ code: '42501' });
});

it('refuses DELETE on order_events', async () => {
  await expect(
    withTenant(ctx, (tx) => tx.execute(sql`DELETE FROM order_events`)),
  ).rejects.toMatchObject({ code: '42501' });
});

it('lets the inserts succeed and fails the COMMIT when a line over-ships', async () => {
  // The trigger is DEFERRABLE INITIALLY DEFERRED, so this is the shape of the
  // assertion: two inserts of 2 against a line of 3 both succeed, and the
  // transaction dies at commit.
  await expect(
    withTenant(ctx, async (tx) => {
      await tx.insert(schema.shipmentItems).values({ ...base, quantity: 2 });
      await tx.insert(schema.shipmentItems).values({ ...base, quantity: 2 });
    }),
  ).rejects.toThrow(/over-ships|exceeds/i);
});

it('counts cancelled units against the same budget', async () => {
  // line of 3, cancelled 2, shipping 2 must fail at commit
});
```

- [ ] **Step 3: Run and watch them fail**

`pnpm --filter @nexmarket/db exec vitest run fulfilment`
Expected: every RLS test fails (no policies yet — the tables are wide open), and
the constraint tests fail (no revoke, no trigger).

- [ ] **Step 4: Write migration 0014**

```bash
pnpm --filter @nexmarket/db exec drizzle-kit generate --custom --name=fulfilment_rls
```

```sql
-- Phase 5 fulfilment: row-level security, the append-only event log, and the
-- over-shipment invariant. None of this is expressible in a schema diff.
--
-- FORCE is not optional. Without it the table OWNER bypasses every policy, and
-- migrations own these tables.

ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipment_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipment_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY tenant_isolation ON "shipments"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY platform_admin_bypass ON "shipments"
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');--> statement-breakpoint

-- THE GATE. Postgres ORs permissive policies, so without the IS NULL a seller
-- reading their own shipments would ALSO match this one and see every other
-- seller's parcels for the same buyer. Migrations 0006, 0008 and 0012 each
-- fixed this bug once. FOR SELECT and no WITH CHECK: a buyer reads shipments,
-- and an inserted shipment is a claim that goods moved and money is owed.
CREATE POLICY own_shipments ON "shipments"
  FOR SELECT
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NULL
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = shipments.order_id
        AND o.buyer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );--> statement-breakpoint
```

Repeat the three policies for `shipment_items` (EXISTS through `shipments` then
`orders`) and for `order_events` (a direct `buyer_user_id` comparison, which is
why that column is denormalised).

Then the append-only revoke:

```sql
-- REVOKE, not GRANT. Migration 0001 ran ALTER DEFAULT PRIVILEGES ... GRANT
-- SELECT, INSERT, UPDATE, DELETE, so this table already carries all four and a
-- narrower GRANT would read like a restriction while removing nothing. ADR 0016
-- paid for that lesson on ledger_entries.
REVOKE UPDATE, DELETE ON "order_events" FROM nexmarket_app;--> statement-breakpoint
```

And the trigger:

```sql
-- shipped + cancelled <= ordered, per order item.
--
-- Not a CHECK: the invariant spans rows in another table. DEFERRABLE INITIALLY
-- DEFERRED because a multi-line shipment is legitimately mid-flight between
-- statements, exactly as the ledger balance is.
--
-- This does not reopen Phase 3's rejection of triggers for the search index.
-- That rejection stands: this trigger WRITES NOTHING and can only refuse.
CREATE OR REPLACE FUNCTION assert_within_ordered() RETURNS trigger AS $$
DECLARE
  ordered_qty integer;
  cancelled_qty integer;
  shipped_qty integer;
BEGIN
  SELECT oi.quantity, oi.cancelled_quantity INTO ordered_qty, cancelled_qty
    FROM order_items oi WHERE oi.id = NEW.order_item_id;

  SELECT COALESCE(SUM(si.quantity), 0) INTO shipped_qty
    FROM shipment_items si WHERE si.order_item_id = NEW.order_item_id;

  IF shipped_qty + cancelled_qty > ordered_qty THEN
    RAISE EXCEPTION
      'Order item % over-ships: % shipped + % cancelled exceeds % ordered',
      NEW.order_item_id, shipped_qty, cancelled_qty, ordered_qty;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER shipment_items_within_ordered
  AFTER INSERT OR UPDATE ON "shipment_items"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_within_ordered();--> statement-breakpoint
```

A matching trigger on `order_items` for `UPDATE OF cancelled_quantity`, calling
the same function with `NEW.id` as the order item, closes the other direction —
cancelling units that were already shipped.

- [ ] **Step 5: Apply and re-run**

```bash
pnpm db:push
pnpm --filter @nexmarket/db test
```
Expected: PASS.

- [ ] **Step 6: Mutation-verify each gate**

For each of the three `own_*` policies: delete the
`NULLIF(current_setting('app.tenant_id', true), '') IS NULL AND` line, recreate
the database (`docker compose down -v && docker compose up -d && pnpm db:push`),
run the suite, and confirm the "does NOT widen a seller read" test **fails**.
Restore the line. A gate nobody has watched fail is a gate nobody has tested.

- [ ] **Step 7: Commit**

```bash
git add packages/db/migrations packages/db/src/fulfilment-rls.test.ts \
        packages/db/src/fulfilment-constraints.test.ts
git commit -m "feat(db): RLS, append-only events and the over-shipment invariant"
```

---

## Task 6: Accept and reject

**Files:**
- Create: `apps/api/src/modules/fulfilment/fulfilment.service.ts`, `fulfilment.module.ts`, `dto.ts`
- Modify: `apps/api/src/app.module.ts` (register the module)
- Create: `apps/api/test/fulfilment.e2e.test.ts` (started here, extended by later tasks)

**Interfaces:**
- Consumes: `assertTransition`, `statusFromCoverage` (Task 1)
- Produces:
  ```ts
  class FulfilmentService {
    accept(orderId: string): Promise<OrderView>;
    reject(orderId: string, reason: string): Promise<OrderView>;
  }
  ```

- [ ] **Step 1: Write the failing e2e test**

```ts
// apps/api/test/fulfilment.e2e.test.ts — NS = `fulfilment-${randomUUID().slice(0, 8)}`
it('lets a seller accept a paid order', async () => {
  const res = await post(`/seller/orders/${orderId}/accept`, sellerToken, sellerId, {});
  expect(res.statusCode).toBe(200);
  expect(res.json().status).toBe('ACCEPTED');
});

it('refuses to accept the same order twice', async () => {
  const res = await post(`/seller/orders/${orderId}/accept`, sellerToken, sellerId, {});
  expect(res.statusCode).toBe(409);
  expect(res.json().code).toBe('INVALID_TRANSITION');
});

it('refuses a rejection with no reason', async () => {
  const res = await post(`/seller/orders/${otherOrderId}/reject`, sellerToken, sellerId, {});
  expect(res.statusCode).toBe(400);
});

it('rejects an order and releases its reservation', async () => {
  const before = await availableStock(listingId);
  const res = await post(`/seller/orders/${otherOrderId}/reject`, sellerToken, sellerId,
    { reason: 'Out of stock at the warehouse' });
  expect(res.statusCode).toBe(200);
  expect(res.json().status).toBe('REJECTED');
  expect(await availableStock(listingId)).toBe(before + 1);
});

it('does not let another seller touch the order', async () => {
  const res = await post(`/seller/orders/${orderId}/accept`, intruderToken, intruderId, {});
  expect(res.statusCode).toBe(404); // Under RLS it does not exist. Not a 403.
});
```

Fixtures: build them in this file (two sellers, one buyer, a checkout that
produces two orders), following `checkout.e2e.test.ts` — never the seed.

- [ ] **Step 2: Run and watch it fail**

`pnpm --filter @nexmarket/api exec vitest run fulfilment`
Expected: FAIL — 404 on every route.

- [ ] **Step 3: Implement accept**

```ts
// apps/api/src/modules/fulfilment/fulfilment.service.ts
@Injectable()
export class FulfilmentService {
  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
    private readonly listings: ListingsService,
    private readonly search: SearchIndexService,
  ) {}

  /** Seller takes the order on. The interceptor has resolved the tenant. */
  async accept(orderId: string): Promise<OrderView> {
    const { tx, userId } = getRequestContext();
    const order = await this.load(tx, orderId);
    assertTransition(order.status, 'ACCEPTED', 'SELLER');

    await tx.update(schema.orders)
      .set({ status: 'ACCEPTED', updatedAt: new Date() })
      .where(eq(schema.orders.id, orderId));

    await this.events.record(tx, order, { type: 'ACCEPTED', actor: 'SELLER', actorUserId: userId });
    return this.orders.forSellerOne(orderId);
  }
}
```

`load` selects the order inside the request transaction and throws
`NotFoundException` when RLS returns nothing — a 404, not a 403, for the reason
`orders.service.ts` already documents.

`assertTransition` throwing `InvalidTransitionError` must surface as **409 with
`code: 'INVALID_TRANSITION'`**, not 500. There is no exception filter to add it
to - `checkout.service.ts:162` throws its `PRICE_CHANGED` conflict inline with a
coded payload, so catch `InvalidTransitionError` at the service boundary and
rethrow the same shape:

```ts
throw new ConflictException({ code: 'INVALID_TRANSITION', from: order.status, to });
```

- [ ] **Step 4: Implement reject**

Rejection cancels every line, so it shares the cancellation path built in Task 9.
For now implement it as: set `cancelled_quantity = quantity` on every line,
release the reservations, set status `REJECTED`, record the event. Task 9
refactors both callers onto one private `cancelLines` and the e2e tests are what
prove the refactor was safe.

Releasing a reservation is:

```ts
await tx.update(schema.inventoryItems)
  .set({ reserved: sql`${schema.inventoryItems.reserved} - ${qty}` })
  .where(eq(schema.inventoryItems.listingId, listingId));
await this.listings.recomputeAvailableStock(tx, listingId);
// reindexForListing, not reindexProduct: cancellation knows the listing, and
// the service resolves the product from it. Both exist; this one needs no join
// at the call site.
await this.search.reindexForListing(tx, listingId);
```

**Never write `listings.available_stock` directly** — one documented writer.
The reindex is required: a rejection can flip a product back to in stock, and a
write that changes what a buyer would FIND must reindex.

- [ ] **Step 5: Run**

`pnpm --filter @nexmarket/api exec vitest run fulfilment` — PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/fulfilment apps/api/src/app.module.ts apps/api/test/fulfilment.e2e.test.ts
git commit -m "feat(api): a seller can accept or reject an order"
```

---

## Task 7: Dispatch — shipments, release, inventory

**Files:**
- Modify: `apps/api/src/modules/fulfilment/fulfilment.service.ts`, `dto.ts`
- Modify: `apps/api/test/fulfilment.e2e.test.ts`

**Interfaces:**
- Consumes: `unitShares`, `shareFor`, `releaseEntries` (Task 2); `LedgerService.post` (existing)
- Produces:
  ```ts
  type CreateShipment = {
    items: { orderItemId: string; quantity: number }[];
    carrierName?: string; trackingNumber?: string; idempotencyKey: string;
  };
  createShipment(orderId: string, input: CreateShipment): Promise<ShipmentView>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it('ships part of an order and leaves it PARTIALLY_SHIPPED', async () => {
  const res = await post(`/seller/orders/${orderId}/shipments`, sellerToken, sellerId, {
    items: [{ orderItemId, quantity: 1 }],
    carrierName: 'Pathao', trackingNumber: 'PT-1', idempotencyKey: randomUUID(),
  });
  expect(res.statusCode).toBe(201);
  const order = await get(`/seller/orders/${orderId}`, sellerToken, sellerId);
  expect(order.json().status).toBe('PARTIALLY_SHIPPED');
});

it('pays the seller only for what shipped', async () => {
  const payable = await sellerPayable(sellerId);
  expect(payable).toBe(expectedFirstShipmentPayable); // asserted to the minor unit
});

it('closes the order to exactly zero outstanding on the last shipment', async () => {
  await post(/* the remaining 2 units */);
  const clearing = await clearingBalanceForOrder(orderId);
  expect(clearing).toBe(0);
  const order = await get(`/seller/orders/${orderId}`, sellerToken, sellerId);
  expect(order.json().status).toBe('SHIPPED');
});

it('does not move stock available to buyers', async () => {
  // on_hand and reserved both fall, so available is unchanged and NO reindex is
  // needed. This test is what keeps that claim honest.
  expect(await availableStock(listingId)).toBe(availableBefore);
});

it('is idempotent on the key', async () => {
  const key = randomUUID();
  const body = { items: [{ orderItemId: secondItemId, quantity: 1 }], idempotencyKey: key };
  const first = await post(`/seller/orders/${orderId}/shipments`, sellerToken, sellerId, body);
  const second = await post(`/seller/orders/${orderId}/shipments`, sellerToken, sellerId, body);
  expect(second.statusCode).toBe(200);
  expect(second.json().id).toBe(first.json().id);
});

it('refuses to ship more than remains', async () => {
  const res = await post(`/seller/orders/${orderId}/shipments`, sellerToken, sellerId, {
    items: [{ orderItemId, quantity: 99 }], idempotencyKey: randomUUID(),
  });
  expect(res.statusCode).toBe(409);
});

it('lets exactly one of two concurrent dispatches of the last unit win', async () => {
  const body = () => ({ items: [{ orderItemId: lastUnitItemId, quantity: 1 }], idempotencyKey: randomUUID() });
  const [a, b] = await Promise.all([
    post(`/seller/orders/${raceOrderId}/shipments`, sellerToken, sellerId, body()),
    post(`/seller/orders/${raceOrderId}/shipments`, sellerToken, sellerId, body()),
  ]);
  const codes = [a.statusCode, b.statusCode].sort();
  expect(codes).toEqual([201, 409]);
});
```

- [ ] **Step 2: Run and watch it fail** — 404 on the route.

- [ ] **Step 3: Implement**

The order of operations inside one transaction:

```ts
async createShipment(orderId: string, input: CreateShipment): Promise<ShipmentView> {
  const { tx, userId } = getRequestContext();

  // 1. Idempotency: insert first and read the row count. Never a prior SELECT -
  //    two concurrent retries of one gateway delivery would both pass it.
  //    (Phase 4 pattern; see checkout.service.ts.)

  // 2. Load the order and its lines, with shipped and cancelled counts.
  const order = await this.load(tx, orderId);
  assertTransition(order.status, 'SHIPPED', 'SELLER'); // ACCEPTED or PARTIALLY_SHIPPED

  // 3. Reserve the units with the conditional UPDATE from ADR 0017 Decision 4 -
  //    predicate INSIDE the FOR UPDATE subquery AND repeated outside, because
  //    Postgres re-checks only the outer WHERE after taking the lock. This is
  //    the check; the constraint trigger is the backstop.
  for (const item of input.items) {
    const result = await tx.execute(sql`
      UPDATE order_items SET updated_at = now()
       WHERE id = (
         SELECT oi.id FROM order_items oi
          WHERE oi.id = ${item.orderItemId}
            AND oi.quantity - oi.cancelled_quantity
                - COALESCE((SELECT SUM(si.quantity) FROM shipment_items si
                             WHERE si.order_item_id = oi.id), 0) >= ${item.quantity}
          FOR UPDATE)
         AND quantity - cancelled_quantity
             - COALESCE((SELECT SUM(si.quantity) FROM shipment_items si
                          WHERE si.order_item_id = order_items.id), 0) >= ${item.quantity}
    `);
    if (result.rowCount === 0) throw new ConflictException('Not enough unshipped units');
  }

  // 4. Money. unitShares over the WHOLE order, consumed = shipped + cancelled
  //    per line BEFORE this shipment, then shareFor the picks.
  const shares = unitShares(money(order.totalAmount, order.currency),
                            money(order.commissionAmount, order.currency), lines);
  const share = shareFor(shares, consumedBefore, input.items);
  await this.ledger.post(tx, {
    paymentIntentId: order.paymentIntentId,
    kind: 'FULFILMENT',
    entries: releaseEntries(order.tenantId, share),
  });

  // 5. Insert the shipment (storing share.total and share.commission) and items.
  // 6. Inventory: on_hand -= qty AND reserved -= qty. Available is unchanged,
  //    so NO reindex - the goods and their reservation left together.
  // 7. Recompute the order status from coverage and write it.
  // 8. Record SHIPMENT_DISPATCHED with the shipment id, carrier and tracking.
}
```

`shipment_number` follows the `orderNumber` generator already in
`checkout.service.ts` — per-seller, human-facing, unique.

- [ ] **Step 4: Run** — `pnpm --filter @nexmarket/api exec vitest run fulfilment`. PASS.

- [ ] **Step 5: Prove the money claim independently**

Run the ledger suite too: `pnpm --filter @nexmarket/api exec vitest run ledger`.
The balance invariant and the deferred trigger cover the new postings for free.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/fulfilment apps/api/test/fulfilment.e2e.test.ts
git commit -m "feat(api): dispatch a shipment and release the seller's payable"
```

---

## Task 8: Mark delivered

**Files:** modify `fulfilment.service.ts`, `fulfilment.controller.ts`, `fulfilment.e2e.test.ts`

**Interfaces:** produces `markDelivered(orderId: string, shipmentId: string): Promise<ShipmentView>`

- [ ] **Step 1: Write the failing tests**

```ts
it('marks a shipment delivered', async () => {
  const res = await post(`/seller/orders/${orderId}/shipments/${shipmentId}/delivered`, sellerToken, sellerId, {});
  expect(res.statusCode).toBe(200);
  expect(res.json().status).toBe('DELIVERED');
});

it('leaves the order SHIPPED while another parcel is in transit', async () => {
  const order = await get(`/seller/orders/${orderId}`, sellerToken, sellerId);
  expect(order.json().status).toBe('SHIPPED');
});

it('moves the order to DELIVERED when the last shipment lands', async () => {
  await post(`/seller/orders/${orderId}/shipments/${secondShipmentId}/delivered`, sellerToken, sellerId, {});
  const order = await get(`/seller/orders/${orderId}`, sellerToken, sellerId);
  expect(order.json().status).toBe('DELIVERED');
});

it('refuses to deliver the same shipment twice', async () => {
  const res = await post(`/seller/orders/${orderId}/shipments/${shipmentId}/delivered`, sellerToken, sellerId, {});
  expect(res.statusCode).toBe(409);
});
```

- [ ] **Step 2: Run, watch it fail (404).**

- [ ] **Step 3: Implement.** Set `shipments.status = 'DELIVERED'` and
`delivered_at`; if no shipment on the order is still `DISPATCHED`, and no unit is
outstanding, move the order to `DELIVERED` via `assertTransition`. Record
`SHIPMENT_DELIVERED`. No ledger posting — the money moved at dispatch. Add a
comment saying so, because this is the obvious place to look for it.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): mark a shipment delivered"
```

---

## Task 9: Cancellation, and the fourth tenant-scope escape

**Files:** modify `fulfilment.service.ts`, `apps/api/src/common/tenant-scope.ts` (docs), `fulfilment.e2e.test.ts`; create `apps/api/test/cancellation.e2e.test.ts` (NS `cancel-`)

**Interfaces:**
- Consumes: `reversalEntries`, `shareFor` (Task 2); `asTenantScope` (existing)
- Produces: `cancelForBuyer(orderId, userId, reason?)`, `cancelLinesForSeller(orderId, picks, reason)`

- [ ] **Step 1: Write the failing tests**

```ts
it('lets a buyer cancel their own unshipped order', async () => {
  const res = await post(`/orders/${orderId}/cancel`, buyerToken, null, { reason: 'Changed my mind' });
  expect(res.statusCode).toBe(200);
  expect(res.json().status).toBe('CANCELLED');
});

it('returns the buyer receivable to the ledger', async () => {
  expect(await buyerReceivableForOrder(orderId)).toBe(0);
});

it('leaves every seller payable untouched', async () => {
  // Nothing dispatched, so nothing was ever credited. This is the dispatch-
  // release decision paying for itself on its first use.
  expect(await sellerPayable(sellerId)).toBe(0);
});

it('releases the reservation and reindexes', async () => {
  expect(await availableStock(listingId)).toBe(before + 1);
  const hit = await get(`/search?q=${slug}`);
  expect(hit.json().items[0].inStock).toBe(true);
});

it('refuses to cancel once a parcel has dispatched', async () => {
  const res = await post(`/orders/${shippedOrderId}/cancel`, buyerToken, null, {});
  expect(res.statusCode).toBe(409);
});

it('does not let a buyer cancel someone else\'s order', async () => {
  const res = await post(`/orders/${orderId}/cancel`, strangerToken, null, {});
  expect(res.statusCode).toBe(404);
});

it('lets a seller cancel the outstanding lines of a partly shipped order', async () => {
  const res = await post(`/seller/orders/${partId}/cancel`, sellerToken, sellerId, {
    items: [{ orderItemId, quantity: 2 }], reason: 'Damaged in the warehouse',
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().status).toBe('SHIPPED'); // everything that will ship, has
});
```

- [ ] **Step 2: Run, watch them fail.**

- [ ] **Step 3: Implement the seller path first**

The interceptor has the tenant, so this is an ordinary tenant-scoped write:
bump `cancelled_quantity` with the same conditional-UPDATE shape as Task 7,
post `reversalEntries` as a `REFUND` transaction, release reservations,
recompute status from coverage, record `LINES_CANCELLED`.

- [ ] **Step 4: Implement the buyer path — the fourth escape**

```ts
async cancelForBuyer(orderId: string, userId: string, reason?: string): Promise<OrderView> {
  return withTenant({ tenantId: null, userId, isAdmin: false }, async (tx) => {
    // `own_orders` proves the order is theirs BEFORE any tenant is chosen. The
    // tenant then comes from the row, inside the transaction - the buyer chose
    // an order, never a tenant, so no caller-supplied value reaches the call.
    const order = await this.loadForBuyer(tx, orderId);
    assertTransition(order.status, 'CANCELLED', 'BUYER');

    return asTenantScope(tx, order.tenantId, async () => {
      // writes to orders, order_items, inventory_items, order_events
      return this.cancelLines(tx, order, everyOutstandingLine(order), 'BUYER', userId, reason);
    });
  });
}
```

Then add the fourth entry to the list at the top of `tenant-scope.ts`, with its
one-line justification, and update the count in its header comment from three to
four.

- [ ] **Step 5: Refactor `reject` onto `cancelLines`**

Task 6 left rejection with its own copy of this logic. Collapse both onto the
private `cancelLines`, and let Task 6's tests prove nothing changed.

- [ ] **Step 6: Run everything that touches stock**

```bash
pnpm --filter @nexmarket/api exec vitest run fulfilment cancellation search checkout
```
Expected: PASS, including the `search.e2e` drift test — which is what verifies
that fulfilment reindexes where it must.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "feat(api): cancellation, and the fourth tenant-scope escape"
```

---

## Task 10: The event log and the buyer's timeline

**Files:** create `apps/api/src/modules/fulfilment/order-events.service.ts`; modify `orders.service.ts` (`OrderView` gains `shipments` and `timeline`), `orders.controller.ts`

**Interfaces:**
- Produces:
  ```ts
  class OrderEventsService {
    record(tx: Transaction, order: OrderRow, event: { type: OrderEventType; actor: Actor; actorUserId: string | null; payload?: Record<string, unknown> }): Promise<void>;
    forOrder(tx: Transaction, orderId: string): Promise<TimelineEntry[]>;
  }
  type TimelineEntry = { id: string; type: string; actor: string; payload: Record<string, unknown>; createdAt: Date };
  type ShipmentView = { id: string; shipmentNumber: string; status: string; carrierName: string | null; trackingNumber: string | null; dispatchedAt: Date; deliveredAt: Date | null; items: { orderItemId: string; quantity: number }[] };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it('gives the buyer a timeline in order', async () => {
  const res = await get(`/me/orders/${orderId}`, buyerToken, null);
  const types = res.json().timeline.map((e: { type: string }) => e.type);
  expect(types).toEqual(['PLACED', 'PAID', 'ACCEPTED', 'SHIPMENT_DISPATCHED']);
});

it('carries the carrier and tracking number in the payload', async () => {
  const res = await get(`/me/orders/${orderId}`, buyerToken, null);
  const dispatched = res.json().timeline.find((e: { type: string }) => e.type === 'SHIPMENT_DISPATCHED');
  expect(dispatched.payload).toMatchObject({ carrierName: 'Pathao', trackingNumber: 'PT-1' });
});

it('shows a buyer the parcels on their order', async () => {
  const res = await get(`/me/orders/${orderId}`, buyerToken, null);
  expect(res.json().shipments).toHaveLength(1);
});

it('shows a seller only their own half of a shared basket', async () => {
  // The second PRD acceptance criterion, at the API.
  const res = await get(`/seller/orders/${orderId}`, sellerToken, sellerId);
  expect(res.json().items.every((i: { listingId: string }) => sellerListingIds.includes(i.listingId))).toBe(true);
});

it('normalises created_at to a Date, not a string', async () => {
  // A raw tx.execute skips Drizzle's column mapping and a timestamptz comes back
  // as a string. The assumption survives every small test and fails on the first
  // result set large enough to page.
  const entries = await withTenant(ctx, (tx) => events.forOrder(tx, orderId));
  expect(entries[0]?.createdAt).toBeInstanceOf(Date);
});
```

- [ ] **Step 2: Run, watch it fail.**

- [ ] **Step 3: Implement.** `record` inserts one row, denormalising `tenant_id`
and `buyer_user_id` off the order. `forOrder` selects ordered by
`(created_at, id)`. Extend `OrderView` and both read paths with `shipments` and
`timeline`; the buyer path gets them through the gated policies, the seller path
through `tenant_isolation`, and neither adds a `WHERE` — the same argument
`orders.service.ts` already makes at length.

Backfill: `checkout.service.ts` records `PLACED` and the webhook records `PAID`,
so a timeline starts at placement rather than at the first seller action.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(api): the order timeline, and shipments on the order view"
```

---

## Task 11: Controllers, the API client, and the contract test

**Files:** create `apps/api/src/modules/fulfilment/fulfilment.controller.ts`; modify `packages/api-client/src/schemas.ts`, `endpoints.ts`, `apps/api/test/contract.e2e.test.ts`, `apps/api/test/route-coverage.e2e.test.ts`

- [ ] **Step 1: Write the failing contract test**

Add every new endpoint to `contract.e2e.test.ts`, asserting the live response
parses against the api-client schema. Add the routes to
`route-coverage.e2e.test.ts`, which fails if a registered route has no test.

- [ ] **Step 2: Run, watch it fail.**

- [ ] **Step 3: Implement the controllers**

```ts
@ApiTags('fulfilment')
@Controller('seller/orders/:id')
export class SellerFulfilmentController {
  constructor(private readonly fulfilment: FulfilmentService) {}

  @Post('accept')
  @RequireCapability('order:write')
  async accept(@Param('id') id: string): Promise<OrderView> {
    return this.fulfilment.accept(id);
  }

  @Post('reject')
  @RequireCapability('order:write')
  async reject(@Param('id') id: string, @Body() body: unknown): Promise<OrderView> {
    return this.fulfilment.reject(id, parseReject(body).reason);
  }

  @Post('shipments')
  @RequireCapability('order:write')
  @HttpCode(201)
  async ship(@Param('id') id: string, @Body() body: unknown): Promise<ShipmentView> {
    return this.fulfilment.createShipment(id, parseCreateShipment(body));
  }

  @Post('shipments/:shipmentId/delivered')
  @RequireCapability('order:write')
  async deliver(@Param('id') id: string, @Param('shipmentId') sid: string): Promise<ShipmentView> {
    return this.fulfilment.markDelivered(id, sid);
  }

  @Post('cancel')
  @RequireCapability('order:write')
  async cancel(@Param('id') id: string, @Body() body: unknown): Promise<OrderView> {
    const input = parseSellerCancel(body);
    return this.fulfilment.cancelLinesForSeller(id, input.items, input.reason);
  }
}
```

Buyer cancellation goes on the existing `BuyerOrdersController` (`me/orders`),
taking `userId` from `req.nexmarketUser.sub` exactly as its siblings do.

DTOs are zod parsers in `dto.ts`, throwing `BadRequestException` — the shape
`search/dto.ts` already uses. `reason` is `z.string().min(1)`: a rejection rate
without reasons tells Phase 7 nothing.

- [ ] **Step 4: Mirror the schemas in `packages/api-client`** and rebuild:
`pnpm --filter @nexmarket/api-client build`.

- [ ] **Step 5: Run** — `pnpm --filter @nexmarket/api exec vitest run contract route-coverage fulfilment`. PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/api/test packages/api-client
git commit -m "feat(api): fulfilment endpoints, typed in the API client"
```

---

## Task 12: The buyer's timeline on the web

**Files:** create `apps/web/components/order-timeline.tsx`, `apps/web/components/shipment-card.tsx`, `apps/web/components/order-timeline.test.tsx`; modify `apps/web/app/orders/[id]/page.tsx`, `apps/web/package.json`, create `apps/web/vitest.config.ts`

**This task chooses the front-end test convention.** `DESIGN-DIRECTION.md` §11
flags that whatever the first screen does becomes the pattern for the whole app,
so it is chosen deliberately here: **Vitest + Testing Library on pure view
helpers and on server-action input validation. No browser runner. No snapshots.**
E2E stays in `apps/api`, against the API.

- [ ] **Step 1: Set up the runner**

Add `vitest`, `@testing-library/react`, `@testing-library/dom`, `jsdom` as dev
dependencies; create `apps/web/vitest.config.ts` with `environment: 'jsdom'`;
replace `"test": "echo 'no web unit tests in phase 0'"` with `"test": "vitest run"`.

- [ ] **Step 2: Write the failing test**

```tsx
// apps/web/components/order-timeline.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrderTimeline, describeEvent } from './order-timeline.js';

describe('describeEvent', () => {
  it('names a dispatch with its carrier', () => {
    expect(describeEvent({ type: 'SHIPMENT_DISPATCHED', payload: { carrierName: 'Pathao' } }))
      .toBe('Dispatched with Pathao');
  });

  it('names a dispatch with no carrier without trailing punctuation', () => {
    expect(describeEvent({ type: 'SHIPMENT_DISPATCHED', payload: {} })).toBe('Dispatched');
  });

  it('gives a rejection its reason', () => {
    expect(describeEvent({ type: 'REJECTED', payload: { reason: 'Out of stock' } }))
      .toBe('Seller could not fulfil this: Out of stock');
  });
});

describe('OrderTimeline', () => {
  it('renders every event in order', () => {
    render(<OrderTimeline entries={[placed, paid, dispatched]} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('colours only the states that mean something', () => {
    // DESIGN-DIRECTION: colour is informational. A neutral step gets no accent.
    render(<OrderTimeline entries={[cancelled]} />);
    expect(screen.getByRole('listitem')).toHaveAttribute('data-tone', 'warning');
  });
});
```

- [ ] **Step 3: Run, watch it fail** — `pnpm --filter @nexmarket/web test`.

- [ ] **Step 4: Implement** the timeline as an ordered list, one row per event,
and the shipment card (carrier, tracking number, its lines). Wire both into
`apps/web/app/orders/[id]/page.tsx`, which is a server component and already
fetches the order — the new fields arrive on the same call. No progress-bar
theatre for states that have not happened.

- [ ] **Step 5: Run and build** — `pnpm --filter @nexmarket/web test && pnpm --filter @nexmarket/web build`.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): the buyer's order timeline, and the first web tests"
```

---

## Task 13: The seller order queue

**Files:** create `apps/web/app/seller/orders/page.tsx`, `apps/web/app/seller/orders/[id]/page.tsx`, `apps/web/app/actions/fulfilment.ts`, `apps/web/components/shipment-form.tsx` and its test

- [ ] **Step 1: Write the failing test** for the server action's input parsing:

```ts
// apps/web/app/actions/fulfilment.test.ts
it('rejects a shipment with no lines', async () => {
  const result = await parseShipmentForm(new FormData());
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/at least one/i);
});

it('drops lines with a zero quantity rather than sending them', async () => {
  const form = new FormData();
  form.set('qty:item-1', '0');
  form.set('qty:item-2', '2');
  const result = await parseShipmentForm(form);
  expect(result.ok && result.value.items).toEqual([{ orderItemId: 'item-2', quantity: 2 }]);
});

it('generates an idempotency key per submission', async () => {
  // A retried dispatch that ships the parcel twice is real money.
});
```

- [ ] **Step 2: Run, watch it fail.**

- [ ] **Step 3: Implement.** List with a status filter, keyset pagination like the
existing lists. Detail page with the verbs, each a server action posting through
`packages/api-client` with the seller's `x-tenant-id`. This is the functional
skeleton, not the designed console — the design pass comes after Phase 5.

- [ ] **Step 4: Run and build.**

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): the seller order queue"
```

---

## Task 14: Packing slip and invoice

**Files:** create `apps/web/app/seller/orders/[id]/packing-slip/page.tsx`, `apps/web/app/orders/[id]/invoice/page.tsx`, `apps/web/app/print.css`

- [ ] **Step 1: Write the failing test** for the money and totals helper both
pages share — `formatInvoiceTotals` — including that VAT is shown as the 15 %
`taxBpsFor('BD')` line the order actually recorded, never recomputed on render.

- [ ] **Step 2: Run, watch it fail.**

- [ ] **Step 3: Implement** both as server components with a print stylesheet:
`@media print` hides the site chrome, sets `@page { margin: 12mm }`, and forces
black-on-white. No PDF library — Ctrl+P is the export, and a label is not built
because a barcode with no carrier behind it scans as nothing.

- [ ] **Step 4: Verify by eye**

`pnpm dev`, open `/seller/orders/<id>/packing-slip`, print to PDF, confirm one
page with no chrome.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): packing slip and invoice print views"
```

---

## Task 15: The acceptance run

**Files:** modify `apps/api/test/fulfilment.e2e.test.ts`

- [ ] **Step 1: Write the two PRD criteria as one narrative test**

```ts
it('PRD 11 Phase 5: a partial shipment settles correctly in the ledger', async () => {
  // A basket across two sellers, chosen so the commission rounds badly.
  // Seller A ships half, then the rest. Seller B ships nothing.
  //   - after A's first shipment: A's payable is exactly the first half's share
  //   - after A's second: A's payable equals what a full capture would have paid
  //   - B's payable is still 0
  //   - every ledger transaction balances
  //   - clearing for the order equals B's untouched gross
});

it('PRD 11 Phase 5: a seller sees only their items on a shared order', async () => {
  // Seller A's GET returns only A's lines and A's shipments; B's returns B's.
  // The buyer's GET returns both orders with both timelines.
});

it('the demo: fulfil one seller\'s half while the other stays pending', async () => {
  // The end-to-end path, asserted on the buyer's view - which is where a demo
  // is actually watched from.
});
```

- [ ] **Step 2: Run** — `pnpm --filter @nexmarket/api exec vitest run fulfilment`. PASS.

- [ ] **Step 3: Run the whole suite** — `pnpm test`. Nothing else may have moved.

- [ ] **Step 4: Commit**

```bash
git commit -am "test: PRD Phase 5 acceptance, end to end"
```

---

## Task 16: Documentation and the gates

**Files:** create `docs/architecture/0019-buyer-cancellation-and-the-fourth-escape.md`,
`docs/architecture/0020-dispatch-release-and-per-unit-allocation.md`; modify
`docs/architecture/README.md`, `docs/SYSTEM-DESIGN.md`, `CLAUDE.md`,
`docs/DESIGN-DIRECTION.md`, `README.md`

- [ ] **Step 1: Write ADR 0019** — buyer cancellation as the fourth
`asTenantScope` call site: the three rejected alternatives, and why the safety
rule still holds (the tenant is read from the row, after `own_orders` has already
proved the order is the buyer's).

- [ ] **Step 2: Write ADR 0020** — why capture stopped crediting sellers, the
`unit 1 × 3 @ 5000 bps` counterexample worked out in full, why `allocate()`
landed at a partial shipment rather than at Phase 8 as Phase 4's plan predicted,
and why the release is stored on the shipment rather than recomputed.

- [ ] **Step 3: Update `docs/SYSTEM-DESIGN.md`** — the order lifecycle diagram
gains five states; §7.2's reindex list gains fulfilment as the fifth site; the
ERD gains three tables; §11's seam list is corrected where it still says
`allocate()` is unused.

- [ ] **Step 4: Update `CLAUDE.md`** — the phase line (0–5 complete), the
reindex-hook sentence, the tenant-scope escape count (three → four), the
100 %-coverage file list (`order-state.ts`, `fulfilment.ts`), and the tenant-owned
table list (`shipments`, `shipment_items`, `order_events`).

- [ ] **Step 5: Close the open decision in `DESIGN-DIRECTION.md` §11** — the
front-end test convention is chosen in Task 12; record what it is.

- [ ] **Step 6: Run all four gates**

```bash
pnpm lint && pnpm type-check && pnpm test && pnpm build
```
Expected: all pass. Then the benchmark, which is not in `pnpm test`:
`pnpm --filter @nexmarket/api perf`.

- [ ] **Step 7: Commit**

```bash
git add docs CLAUDE.md README.md
git commit -m "docs: two ADRs, the Phase 5 lifecycle, and the claims that changed"
```

---

## Self-review notes

- **Spec coverage.** §2 → Task 1; §2.2 → Task 1 Step 3 comment; §3 → Tasks 4–5;
  §4 → Task 5; §5.1 → Task 3; §5.2–5.3 → Tasks 2 and 7; §5.4 → Task 9;
  §5.5 → Tasks 7 and 15; §6 → Tasks 6, 7, 9; §7 → Task 9; §8 → Task 11;
  §9 → Tasks 12–14; §10 → spread across each task's tests plus Task 15;
  §11 → Task 16; §12 is the out-of-scope list and needs no task.
- **Known ordering constraint.** Task 3 changes capture before any release path
  exists, so between Tasks 3 and 7 a captured order credits no seller at all.
  That is a correct intermediate state — no seller has shipped — and the ledger
  balances throughout, which is why the gates still pass mid-plan.
- **Task 6 leaves a deliberate duplication** that Task 9 collapses. Called out in
  both tasks so a reviewer does not flag it as an oversight in between.
