# ADR 0019 - Buyer cancellation, and the fourth tenant-scope escape

**Status:** accepted
**Date:** 2026-09-10
**Phase:** 5
**Implements:** PRD 9.1 (buyer order history and cancellation), 9.2 (seller order
fulfilment), 11 Phase 5.

## Context

`common/tenant-scope.ts` ends with an instruction rather than a description:

> IF YOU ARE ADDING A THIRD, STOP. The question to answer first is whether the
> work is genuinely not tenant-scoped, or whether it is tenant-scoped work being
> done from the wrong place. It has been the second more often than the first.

Phase 5 needs a buyer to be able to cancel their own order. That writes to
`orders`, `order_items`, `inventory_items` and `order_events` - all tenant-owned
- and a buyer is not a tenant. So the question got asked. This is the answer.

## Decision: `asTenantScope(order.tenant_id)`, and the three rejected alternatives

| Option | Verdict |
|---|---|
| Run buyer cancellation as a platform admin | **No.** It hands a buyer's transaction unrestricted read of every tenant's rows for its duration, to solve a narrow write problem. ADR 0017 rejected exactly this argument for checkout, and nothing has changed except the verb |
| A gated buyer `UPDATE` policy | **Partly expressible, and that is the problem.** On `orders` it works: `USING` buyer + status in the cancellable set, `WITH CHECK` status = `CANCELLED`. On `inventory_items` it does not, and a buyer-writable inventory policy is not a thing this codebase should own. A rule that covers three tables out of four is a rule nobody can rely on |
| Make cancellation a request the seller actions | **Rejected on product grounds.** A "cancel" button that means "ask" is a support ticket wearing a button, and the buyer has done nothing wrong by changing their mind before anything shipped |
| `asTenantScope(tx, order.tenantId, ...)` for exactly those writes | **Yes** |

The safety rule in `tenant-scope.ts` holds unchanged, and it is the whole reason
this is permitted rather than merely convenient:

> Never pass a caller-supplied id.

`order.tenant_id` is **read from the database inside the transaction**, after
`own_orders` has already proved the order belongs to this buyer. The buyer chose
an **order**; they never chose a tenant. That is the same shape as checkout,
where the seller id comes from `listings.tenant_id` because the buyer chose a
listing.

And the question the file demands has a real answer: this is genuinely a
non-tenant initiating tenant-scoped writes, not tenant-scoped work being done
from the wrong place. The prior three escapes' failure mode does not apply.

## Decision 2: the write runs in the REQUEST transaction, not a nested one

The first sketch opened its own `withTenant({ tenantId: null, userId })`, by
analogy with `OrdersService.forBuyer`. That analogy is wrong, and the difference
matters:

- `forBuyer` is a **read**. Its own transaction is fine, and arguably tidier.
- a cancellation is a **write**, and it must be atomic with the ledger reversal,
  the stock release and the event it records.

A nested `withTenant` would have run those on a second connection - so a failure
half way through would have left the order cancelled and the money not reversed,
and the response would have been read back from a transaction that could not see
the cancellation it had just made. `OrdersService.oneWithin` exists for that last
reason: reading the result of a write requires the transaction that did it.

The interceptor already opens the buyer's request with `app.user_id` set and no
tenant, which is exactly the context this needs. There was never a second
transaction to open.

## Decision 3: whole-order only for a buyer, line-level for a seller

A buyer cancels the order or nothing. Dropping one item of several is a return,
and returns are Phase 8 with an inspection step and a different money path.

A seller cancels **lines**, because the case that actually happens is "two of
these three are damaged". That is also the one path that can leave a partly
shipped order: cancelling the remainder lands it on `SHIPPED`, since every unit
that was ever going to move has moved.

Its guard is deliberately **not** the transition table. That table answers "may
this actor move the order to X", and after a line cancellation the destination is
computed from coverage rather than chosen - so the check is the narrower question
of whether the order is still open enough to lose lines.

## Consequences

- `tenant-scope.ts` now documents **four** call sites and says to stop before a
  fifth. The list is: founding an organisation, reindexing search, checkout, and
  this.
- Cancellation makes fulfilment the **fifth** search-reindex site. Returning the
  last unit to the shelf is exactly the write that flips `in_stock`, and
  `search.e2e`'s drift test covers it.
- `own_orders` is now load-bearing for a **write** path as well as a read: it is
  what proves the order is the caller's before the tenant is taken from it. It
  remains `FOR SELECT` with no `WITH CHECK`, because a buyer must still never
  insert an order.

## Related

- `apps/api/src/common/tenant-scope.ts`, `modules/fulfilment/fulfilment.service.ts`
- `apps/api/test/fulfilment.e2e.test.ts` - the buyer cancellation cases
- ADR 0011 (`app.user_id`), 0017 (the third escape and the buyer policy),
  0020 (why no seller payable is reversed)
