# ADR 0018 - The payment port, cash on delivery, and why Stripe is not here yet

**Status:** accepted
**Date:** 2026-09-04
**Phase:** 4
**Implements:** PRD 10.1 (PaymentProvider port), 11 Phase 4, 13 (idempotency, webhook signatures).

## Context

PRD 11 Phase 4 lists "`PaymentProvider` port + mock/Stripe-test/COD adapters"
and makes **"the webhook is the only writer of payment status"** a blocking
acceptance criterion.

## Decision 1: the webhook is the only writer, enforced by shape

`POST /checkout/confirm` creates an intent at `REQUIRES_PAYMENT` or
`COD_PENDING` and **never advances it**, even for the mock adapter that could
settle synchronously. `PaymentWebhookService.apply()` is the sole caller of the
transition.

The port makes it unenforceable to break: `CreateIntentResult.initialStatus` is
typed `'REQUIRES_PAYMENT' | 'COD_PENDING'`. An adapter **cannot** return a
settled status, so the rule is a type error rather than a code review.

The test asserts the intent is still `REQUIRES_PAYMENT` after a successful
confirm, and that the ledger holds nothing for it, before delivering the webhook
that captures.

## Decision 2: idempotency is a UNIQUE CONSTRAINT, never a lookup

Gateways retry. Two deliveries of one event arriving concurrently would both
pass a prior `SELECT ... WHERE provider_event_id = $1` and both post a capture -
that is how a retry becomes a double charge.

```sql
INSERT INTO payment_events (provider, provider_event_id, type)
VALUES ($1, $2, $3) ON CONFLICT (provider, provider_event_id) DO NOTHING
RETURNING id;
```

The row count is the answer. The test delivers the same event twice and counts
**one** transaction.

The same shape guards checkout: `payment_intents.idempotency_key` is unique, so
a double-submitted confirm returns the original orders rather than placing a
second set. A key belonging to a different buyer is a 409, not a replay -
returning another buyer's orders would be the worst possible answer.

## Decision 3: always answer 200

A gateway reads any non-2xx as "retry". Answering 400 to a forged or duplicate
delivery turns one bad request into a retry storm. The outcome is in the body
and the logs; the status code is for the transport.

A forged signature, a malformed body and an unknown event type all produce the
same answer, deliberately. Distinguishing them tells an attacker which half to
fix.

## Decision 4: cash on delivery is a first-class method

`cod` is not a fallback. It is how most of the primary market pays, and it is
the case that justifies a double-entry ledger existing at all.

No gateway, no redirect, no client secret. The intent goes to `COD_PENDING`, the
order is placed, and checkout posts to `COD_RECEIVABLE` - the account that
measures the gap between "delivered" and "collected". Collection and
reconciliation are Phase 6, where the money actually arrives.

`CodPaymentAdapter.verifyWebhook` returns `null` always, and that is **correct
rather than unfinished**: nothing external can tell this adapter that cash was
received. Only a courier reconciliation can, and it will arrive through the
Phase 6 shipping flow as a domain event, not as a payment webhook.

## Decision 5: the mock adapter signs its webhooks for real

`MockPaymentAdapter` is a mock, not a stub. It computes a real HMAC-SHA256 over
the raw body and verifies it with `timingSafeEqual`, so the whole webhook path -
signature check, idempotency insert, ledger posting - is exercised exactly as a
live gateway would exercise it.

PRD 14 R7 is the reason: a mock that skipped the signature would leave the one
security-critical branch of the integration untested until the day it went live.

Length is compared before `timingSafeEqual`, which **throws** on a length
mismatch - and an exception is itself a timing signal.

The raw body matters. A signature is over bytes, and `JSON.parse` followed by
`JSON.stringify` does not reproduce them; key order and whitespace both move.
Nest's `adapter.useBodyParser('application/json', true, ...)` captures it, and
that call lives in `configure-app.ts` - the one place `main.ts` and the e2e
suite share. Registered only in `main.ts`, every webhook test would verify
against an empty body.

## Decision 6: Stripe is deliberately absent

The PRD names three adapters. Two ship.

Building a Stripe adapter now, against an account that does not exist, produces
code no test can exercise and a README claim nobody can check - which is the
specific failure this repository is a reaction to. The port is the seam: adding
it is one class implementing `PaymentProvider` plus one line in
`payments.module.ts`, and the shared contract both shipped adapters satisfy is
what makes that a drop-in rather than a rewrite.

**This is recorded as a deviation from PRD 11 Phase 4, not as a completed item.**

## Related

- `apps/api/src/modules/payments/`
- `apps/api/src/configure-app.ts` (the raw body)
- `apps/api/test/checkout.e2e.test.ts`
- ADR 0016 (the ledger the webhook posts to), 0017 (orders)
