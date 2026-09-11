'use server';

import { revalidatePath } from 'next/cache';
import { endpoints } from '@nexmarket/api-client';
import { ApiError, apiCall } from '@/lib/api/server';

export type ReturnActionResult = { ok: true } | { ok: false; message: string };

/**
 * Books a courier to collect a delivered order.
 *
 * PRD 11 Phase 6's reverse logistics, and ONLY its logistics half: this books a
 * van. Whether the return is accepted, inspected or refunded is the RMA
 * workflow, which is Phase 8 - so the copy around this must not promise a
 * refund, and the action returns nothing that implies one.
 */
export async function scheduleReturnPickup(
  orderId: string,
  slotId: string,
): Promise<ReturnActionResult> {
  try {
    await apiCall(endpoints.scheduleReturnPickup(orderId), {
      method: 'POST',
      auth: true,
      body: { slotId },
    });

    revalidatePath(`/orders/${orderId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    return { ok: false, message: 'Could not book a collection just now. Try again shortly.' };
  }
}
