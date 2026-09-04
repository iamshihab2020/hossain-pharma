# ADR 0012 - Refresh tokens are families, and are stored as SHA-256

**Status:** accepted
**Date:** 2026-09-04
**Phase:** 1
**Implements:** plan decision D-B; PRD 13.

## Context

PRD 13 requires refresh-token rotation with **reuse detection**: presenting a
token that has already been rotated must be treated as theft, not as a retry.

The obvious schema is one row per token, updated in place on rotation. It cannot
express the requirement. Once the old hash has been overwritten, a stolen token
and an unknown one are byte-identical to the server - both simply fail to match
any row - so the only available answer is 401, and the attacker's other stolen
tokens keep working.

## Decision

`sessions` stores a **family**. Rotation INSERTS a new row sharing `family_id`
and revokes the previous row with reason `rotated`, rather than updating one row
in place. Three outcomes:

| Presented hash | Meaning | Action |
|---|---|---|
| matches a live row | normal rotation | new row, same family, old row revoked as `rotated` |
| matches nothing | unknown token | 401 |
| matches a **revoked** row | **replay** | revoke the WHOLE family, then 401 |

Revocation targets the family, not the user: one stolen token kills that login,
not every device the person is signed in on.

`generation` is an integer counter, incremented in SQL. The plan specified text;
this is the one deliberate deviation, because a text column would force a
parse-and-write round trip that two concurrent refreshes could interleave.

## Decision: SHA-256, not argon2id

`password_hash` is argon2id. `refresh_token_hash` is SHA-256, and the difference
is not an inconsistency.

A refresh token is 256 bits from `crypto.randomBytes`. It is not user-chosen, it
has no structure, and it cannot be brute-forced or guessed from a leaked digest
- so the property argon2id buys (making each guess expensive) protects against
an attack that does not exist here. What it would cost is ~100 ms on every
refresh, on the one endpoint every signed-in client hits on a timer.

Argon2id stays on passwords, where humans choose the input and guessing is the
whole threat.

## The transaction-boundary bug this uncovered

The first implementation revoked the family and threw from inside the same
`withTenant` callback. `withTenant` runs its callback in a transaction, so
throwing **rolled back the revocation**: the request 401'd, the attacker
retried, and it worked. The test failure looked like a policy bug and was a
transaction-boundary bug.

The transaction now returns a verdict, and the throw happens after it commits:

```ts
const outcome = await this.run(async (tx) => { /* ... returns 'ok' | 'revoke' | 'unknown' */ });
if (outcome.kind === 'ok') return outcome.result;
if (outcome.kind === 'revoke') await this.run((tx) => this.revokeFamily(tx, ...));
throw new UnauthorizedException('Invalid session');
```

This is worth stating plainly because the shape recurs: **any security action
taken on the failure path of a transactional handler is undone by the throw that
reports the failure.** Detection and rejection have to be separate transactions.

## Consequences

- `sessions` grows one row per rotation rather than staying at one row per
  login. That is the cost of keeping the superseded hash, which is the thing
  reuse detection needs. Pruning revoked rows older than the refresh TTL is a
  later phase's housekeeping job, not a correctness concern.
- The refresh token never appears in a response body. It is set as an httpOnly
  cookie scoped to `/auth`, so it is not attached to every API call.
- Logout revokes the family, not the presented token - otherwise "sign out"
  ends one request's token and nothing else. It is silent on an unknown token,
  because logout must never report whether a session existed.
- Google OAuth mints sessions through the same `startSession`, so every property
  proved for the password path holds for the OAuth path by construction rather
  than by a second implementation that has to be kept in step.

## Related

- `packages/db/src/schema/users.ts` (the `sessions` table)
- `apps/api/src/modules/auth/auth.service.ts`, `tokens.ts`
- `packages/db/migrations/0005_session_families.sql`
- `apps/api/test/auth.e2e.test.ts`
- ADR 0008 (Google OAuth), PRD 13
