import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Plays the payment gateway.
 *
 * Checkout leaves an order PENDING_PAYMENT and never advances it: ADR 0018
 * makes the WEBHOOK the only writer of payment status, and the port types
 * `initialStatus` so no adapter can return a settled one. That is correct, and
 * it means a browser journey has no way to reach PAID on its own - nothing in
 * the storefront calls back, because in production a gateway would.
 *
 * So the suite calls back, signed the way the mock adapter signs, which keeps
 * the security-critical branch - signature check, idempotency insert, ledger
 * posting - on the path rather than stubbed around.
 */
const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4001';
const SECRET = process.env['PAYMENT_WEBHOOK_SECRET'] ?? '';

export async function settlePayment(
  request: APIRequestContext,
  buyerEmail: string,
): Promise<void> {
  // The REF as stored, not rebuilt from the id. Reconstructing it as
  // `mock_<id>` produced "no such payment intent" the moment the journey paid
  // by another method, because the adapter that handled it had written
  // `cod_<id>` instead.
  const providerRef = latestProviderRefFor(buyerEmail);

  const body = JSON.stringify({
    id: `e2e-evt-${randomUUID()}`,
    type: 'payment_succeeded',
    providerRef,
  });

  const response = await request.post(`${API_URL}/webhooks/payment/mock`, {
    headers: {
      'content-type': 'application/json',
      'x-mock-signature': createHmac('sha256', SECRET).update(body).digest('hex'),
    },
    data: body,
  });

  const text = await response.text();
  expect(response.ok(), `webhook rejected: ${text}`).toBe(true);
  // The body carries a REASON when it declines, and that reason is the whole
  // diagnostic - "applied: false" alone says nothing about why.
  expect(JSON.parse(text) as { applied: boolean }, `webhook not applied: ${text}`).toMatchObject({
    applied: true,
  });
}

/**
 * The buyer's most recent payment REFERENCE, read straight from the database.
 *
 * The browser never sees this id: checkout runs server-side, so the confirm
 * response never reaches the page, and no endpoint exposes it afterwards. A
 * gateway would have been handed it at authorisation time; the suite has to
 * look it up instead.
 */
function latestProviderRefFor(buyerEmail: string): string {
  const out = execFileSync(
    'docker',
    [
      'exec',
      'nexmarket-postgres-e2e',
      'psql',
      '-U',
      'postgres',
      '-d',
      'nexmarket_e2e',
      '-t',
      '-A',
      '-c',
      `SELECT pi.provider_ref FROM payment_intents pi
         JOIN users u ON u.id = pi.buyer_user_id
        WHERE u.email = '${buyerEmail}'
        ORDER BY pi.created_at DESC
        LIMIT 1`,
    ],
    { encoding: 'utf8' },
  ).trim();

  if (out === '') throw new Error(`No payment intent for ${buyerEmail} - did checkout run?`);
  return out;
}
