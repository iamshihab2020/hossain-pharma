'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { endpoints } from '@nexmarket/api-client';
import { ApiError, apiCall } from '@/lib/api/server';
import { toMinorUnits } from '@/lib/money-input';

export type CodActionResult = { ok: true } | { ok: false; message: string };

/**
 * Records cash a courier handed back.
 *
 * The idempotency key is minted HERE, per submission, rather than in the
 * component. A key held in component state would be reused by a second click
 * after a first one failed for a reason the seller then fixed - and the server
 * refuses a repeat collection on the order regardless, so the key's job is to
 * identify the attempt rather than to be the guard.
 */
export async function collectCod(
  tenantId: string,
  orderId: string,
  amount: string,
  currency: string,
): Promise<CodActionResult> {
  const minor = toMinorUnits(amount);
  if (minor === null) return { ok: false, message: 'Enter an amount, like 2400 or 2400.50.' };
  if (minor <= 0) return { ok: false, message: 'A collection must be more than zero.' };

  try {
    await apiCall(endpoints.collectCod(orderId), {
      method: 'POST',
      auth: true,
      tenantId,
      body: { amountMinor: minor, currency, idempotencyKey: randomUUID() },
    });

    revalidatePath('/seller/cod');
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    return { ok: false, message: 'Could not record that just now. Try again in a moment.' };
  }
}
