'use server';

import { revalidatePath } from 'next/cache';
import { createAddressSchema, endpoints, type Confirmation, type Money } from '@nexmarket/api-client';
import { ApiError, apiCall } from '@/lib/api/server';
import { optionalTextField, textField } from '@/lib/form';

/**
 * Checkout writes.
 *
 * `expectedTotal` is the interesting one. It is a COMPARISON, never an input:
 * the server recomputes every amount from `listings` inside its own
 * transaction, and this field only decides whether that answer matches what the
 * buyer was shown. A mismatch is a 409 carrying the new quote, and this file
 * hands that difference back to the page rather than flattening it to "an error
 * occurred" - the buyer's next move is to look at the new number, not to retry.
 */

export type AddressState = { error: string | null; fieldErrors: Record<string, string> };

export async function createAddress(
  _previous: AddressState,
  formData: FormData,
): Promise<AddressState> {
  const raw = {
    recipientName: textField(formData, 'recipientName'),
    phone: textField(formData, 'phone'),
    line1: textField(formData, 'line1'),
    line2: optionalTextField(formData, 'line2'),
    city: textField(formData, 'city'),
    district: textField(formData, 'district'),
    postcode: textField(formData, 'postcode'),
    countryCode: textField(formData, 'countryCode', 'BD'),
  };

  // Validated against the SAME schema the API uses, so the form says what is
  // wrong before a round trip rather than after one.
  const parsed = createAddressSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && fieldErrors[key] === undefined) {
        fieldErrors[key] = issue.message;
      }
    }
    return { error: 'Check the highlighted fields.', fieldErrors };
  }

  try {
    await apiCall(endpoints.createAddress(), { method: 'POST', body: parsed.data });
  } catch (error) {
    const message =
      error instanceof ApiError ? error.message : 'That address could not be saved.';
    return { error: message, fieldErrors: {} };
  }

  revalidatePath('/checkout');
  return { error: null, fieldErrors: {} };
}

export type ConfirmResult =
  | { status: 'placed'; confirmation: Confirmation }
  | { status: 'price-changed'; message: string; expected: Money | null; actual: Money | null }
  | { status: 'age-required' }
  | { status: 'error'; message: string };

export async function confirmCheckout(input: {
  addressId: string;
  paymentMethod: 'cod' | 'mock';
  idempotencyKey: string;
  expectedTotal: Money;
  dateOfBirth?: string;
}): Promise<ConfirmResult> {
  try {
    const { data } = await apiCall(endpoints.confirm(), {
      method: 'POST',
      body: {
        addressId: input.addressId,
        paymentMethod: input.paymentMethod,
        idempotencyKey: input.idempotencyKey,
        expectedTotal: input.expectedTotal,
        ...(input.dateOfBirth === undefined ? {} : { dateOfBirth: input.dateOfBirth }),
      },
    });

    // The cart is gone and the order list has grown.
    revalidatePath('/', 'layout');
    revalidatePath('/orders');
    return { status: 'placed', confirmation: data };
  } catch (error) {
    if (!(error instanceof ApiError)) {
      return { status: 'error', message: 'Checkout is unavailable right now.' };
    }

    // These three codes are the reason ApiError keeps the body rather than
    // flattening it. Each one has a different next move for the buyer.
    if (error.code === 'PRICE_CHANGED') {
      return {
        status: 'price-changed',
        message: error.message,
        expected: error.expected,
        actual: error.actual,
      };
    }
    if (error.code === 'AGE_CHECK_REQUIRED') return { status: 'age-required' };
    if (error.code === 'AGE_CHECK_FAILED') {
      return { status: 'error', message: error.message };
    }

    return { status: 'error', message: error.message };
  }
}
