import { createHmac } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Plays the courier's network.
 *
 * The same shape as `gateway.ts`, and for the same reason: nothing in the
 * storefront can advance a parcel. `ShippingProvider` is a separate port from
 * the quote port precisely because it talks to somebody else's system, and in
 * production a courier's scanner is what calls back. A browser has no way to
 * reach OUT_FOR_DELIVERY on its own.
 *
 * So the suite calls back, signed the way the mock adapter signs, which keeps
 * the security-critical branch - the constant-time signature check, then the
 * comparison that makes a replay a no-op - on the path rather than stubbed
 * around.
 *
 * The secret is NOT the payment one. Two webhooks trusting one secret are one
 * webhook, and a courier able to forge a capture is the whole reason they are
 * separate.
 */
const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4001';
const SECRET =
  process.env['SHIPPING_WEBHOOK_SECRET'] ?? 'nexmarket-dev-shipping-secret-change-me';

/** The states a parcel moves through, in order. An event not AHEAD of where the
 *  parcel already is does nothing, which is what makes the webhook replayable. */
export type CarrierEvent = 'DISPATCHED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

/**
 * The raw signed POST, for callers that want to judge the response themselves.
 *
 * Separate from `reportCarrierEvent` because a REFUSAL is a legitimate outcome
 * worth asserting - a replayed event is answered 200 with `applied: false` -
 * and a helper that asserts success cannot express that.
 */
export function signedCarrierPost(
  request: APIRequestContext,
  trackingNumber: string,
  type: CarrierEvent,
): Promise<APIResponse> {
  const body = JSON.stringify({ trackingNumber, type });

  return request.post(`${API_URL}/webhooks/shipping/mock`, {
    headers: {
      'content-type': 'application/json',
      'x-carrier-signature': createHmac('sha256', SECRET).update(body).digest('hex'),
    },
    data: body,
  });
}

/** One scan that must move the parcel. */
export async function reportCarrierEvent(
  request: APIRequestContext,
  trackingNumber: string,
  type: CarrierEvent,
): Promise<void> {
  const response = await signedCarrierPost(request, trackingNumber, type);

  const text = await response.text();
  expect(response.ok(), `carrier webhook rejected: ${text}`).toBe(true);
  // ALWAYS 200, even for a refusal - a courier reads any non-2xx as "retry".
  // So the body carries the verdict, and the reason with it: "applied: false"
  // alone says nothing about which half went wrong.
  expect(
    JSON.parse(text) as { applied: boolean },
    `carrier event ${type} not applied: ${text}`,
  ).toMatchObject({ applied: true });
}
