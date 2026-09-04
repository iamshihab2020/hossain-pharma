# ADR 0013 - The capability matrix is data, and guards never read role names

**Status:** accepted
**Date:** 2026-09-04
**Phase:** 1
**Implements:** PRD 5.3.

## Context

The legacy system put a single role on the user row and checked it inline:
`verifySeller` rejected admins, `verifyAdmin` rejected sellers, so an admin
could not manage their own products. Roles were mutually exclusive because the
check sites made them so, not because the business wanted that.

PRD 5.1 requires the opposite: one human, several organisations, a different
role in each, and buyer at the same time.

## Decision

`ORG_ROLE_CAPABILITIES` in `@nexmarket/shared` is the PRD 5.3 table, transcribed
as data:

|  | Products | Orders | Analytics | Finance | Members | Settings |
|---|---|---|---|---|---|---|
| OWNER | rw | rw | rw | rw | rw | rw |
| MANAGER | rw | rw | rw | r | – | r |
| STAFF | r | rw | – | – | – | – |
| FINANCE | – | r | rw | rw | – | – |

Routes declare `@RequireCapability('member:write')`. **No guard, service or
controller anywhere reads a role name.** A check written as `role === 'OWNER'`
has reintroduced exactly the coupling this table removes: adding a sub-role or
moving one permission then means finding every call site instead of editing one
row.

Three properties are deliberate:

- **The answer is the union across roles, never the maximum or the first
  match.** One human can hold two roles in one organisation, and STAFF+FINANCE
  legitimately means both sets.
- **An unrecognised role contributes nothing rather than throwing.** This runs
  inside a guard, and a guard that throws on unexpected data fails open under
  some framework configurations. Contributing nothing fails closed.
- **The capability is a string in a closed union**, so a typo is a type error
  rather than a permanently-denied route nobody notices.

`platform_role` is a separate axis with exactly two values, `BUYER` and `ADMIN`.
**There is no `SELLER`, and adding one is a regression** - seller capability
comes from membership in an organisation, never from a field on the user. The
enum's shape is what prevents the legacy bug from returning.

## Two declarations of one list

`OrgRole` in `@nexmarket/shared` and the `org_role` pgEnum in `packages/db` are
two declarations of the same four values, and they are the most likely thing in
this phase to drift. They are kept together by:

- a comment on each pointing at the other;
- `capabilities.test.ts`, which asserts `ALL_CAPABILITIES` equals the set the
  matrix actually grants, in both directions;
- the fact that a role present in one and absent from the other fails at the
  database on insert rather than silently.

A single generated source would be better and is not worth a code generator in
Phase 1. Recorded here so the next person knows it was a decision.

## Status changes the effective set

`check(required, roles, isAdmin, status)` filters what the roles grant by the
organisation's PRD 6.6 status. A SUSPENDED organisation loses `product:write`,
`settings:write`, `payout:write` and `member:write` while keeping everything
else - because "Suspended seller can still fulfil open orders" is an acceptance
criterion, and stranding a buyer mid-order is worse than letting a suspended
seller ship. An OWNER of a suspended organisation therefore *holds*
`member:write` by role and does not hold it *in effect*, and the two failures
carry different messages so support can tell them apart.

A platform ADMIN passes every capability check. Note that admin access to *rows*
comes from the `platform_admin_bypass` policy in migration 0004, not from this
check. Both are needed and they are not the same mechanism: one decides whether
the handler runs, the other decides which rows it can see. Removing either
leaves admin broken in a different way.

## Consequences

- Changing who may do what is a change to one table in one file, with a test
  that reads the PRD table back.
- The matrix lives in `@nexmarket/shared`, which is framework-free, so the same
  data is available to the worker and to any future service without importing
  NestJS.
- ADR 0009 covers why the check runs inside `TenantInterceptor` rather than in a
  guard registered on `APP_GUARD`.

## Related

- `packages/shared/src/capabilities.ts`, `capabilities.test.ts`
- `apps/api/src/common/guards/capability.guard.ts`
- `apps/api/src/common/decorators/capabilities.decorator.ts`
- `packages/db/src/schema/org-members.ts`, `users.ts`
- PRD 5.1, 5.3, 6.6
