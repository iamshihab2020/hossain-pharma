'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { endpoints, type Endpoint } from '@nexmarket/api-client';
import { ApiError, apiCall } from '@/lib/api/server';
import { parseReasonForm, parseShipmentForm } from '@/lib/shipment-form';

/**
 * The seller's fulfilment verbs, from the console.
 *
 * Each one is a Server Action for the same reason the cart's are: the browser
 * cannot reach the API at all - no CORS is registered on the Nest app,
 * deliberately, so the tokens stay httpOnly - and these run on the Next server,
 * which holds the session.
 *
 * Every call carries `tenantId`. The API validates it as a UUID and checks
 * membership before any query runs, so it is a request to act as that
 * organisation rather than a claim to be it.
 */

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function acceptOrder(tenantId: string, orderId: string): Promise<ActionResult> {
  return run(tenantId, orderId, endpoints.acceptOrder(orderId), {});
}

export async function rejectOrder(
  tenantId: string,
  orderId: string,
  form: FormData,
): Promise<ActionResult> {
  const reason = parseReasonForm(form);
  if (!reason.ok) return { ok: false, message: reason.error };
  return run(tenantId, orderId, endpoints.rejectOrder(orderId), { reason: reason.value });
}

export async function cancelLines(
  tenantId: string,
  orderId: string,
  form: FormData,
): Promise<ActionResult> {
  const reason = parseReasonForm(form);
  if (!reason.ok) return { ok: false, message: reason.error };
  return run(tenantId, orderId, endpoints.cancelLines(orderId), { reason: reason.value });
}

export async function dispatchShipment(
  tenantId: string,
  orderId: string,
  form: FormData,
): Promise<ActionResult> {
  /**
   * The key is minted HERE, once per submission.
   *
   * Generating it in the API would defeat the point, and reusing one across
   * submissions would make a second, legitimate parcel silently return the
   * first. A retried dispatch that shipped twice releases the seller's payable
   * twice, which is why this is a key and not a flag.
   */
  const parsed = parseShipmentForm(form, randomUUID());
  if (!parsed.ok) return { ok: false, message: parsed.error };

  return run(tenantId, orderId, endpoints.createShipment(orderId), parsed.value);
}

export async function markDelivered(
  tenantId: string,
  orderId: string,
  shipmentId: string,
): Promise<ActionResult> {
  return run(tenantId, orderId, endpoints.markDelivered(orderId, shipmentId), {});
}

async function run<T>(
  tenantId: string,
  orderId: string,
  descriptor: Endpoint<T>,
  body: unknown,
): Promise<ActionResult> {
  try {
    await apiCall(descriptor, { method: 'POST', body, auth: true, tenantId });
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: messageFor(error) };
    throw error;
  }

  revalidatePath('/seller/orders');
  revalidatePath(`/seller/orders/${orderId}`);
  return { ok: true };
}

/**
 * What the seller should read, rather than what the API said.
 *
 * A 409 here is almost always someone acting on a page that has moved on - a
 * second tab, or a colleague who accepted the order a moment ago - so the
 * message says to reload rather than blaming the click.
 */
function messageFor(error: ApiError): string {
  if (error.status === 409) {
    return error.code === 'INVALID_TRANSITION'
      ? 'This order has already moved on. Reload to see where it is now.'
      : 'That is more than this order has left. Reload to see what remains.';
  }
  if (error.status === 404) return 'This order is no longer available to you.';
  if (error.status === 403) return 'Your role does not include fulfilling orders.';
  return 'That did not go through. Try again.';
}
