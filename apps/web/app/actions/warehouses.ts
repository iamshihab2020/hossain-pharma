'use server';

import { revalidatePath } from 'next/cache';
import { endpoints } from '@nexmarket/api-client';
import { ApiError, apiCall } from '@/lib/api/server';
import { parseWarehouseForm } from '@/lib/warehouse-form';

/**
 * Warehouse mutations, from the console.
 *
 * A Server Action for the same reason every other one is: the browser cannot
 * reach the API - no CORS is registered on the Nest app, deliberately, so the
 * tokens stay httpOnly - and this runs on the Next server, which holds the
 * session.
 *
 * `tenantId` travels on every call. The API validates it as a UUID and checks
 * membership before any query runs, so it is a request to act as that
 * organisation rather than a claim to be it.
 */
export type WarehouseActionResult = { ok: true } | { ok: false; message: string };

export async function createWarehouse(
  tenantId: string,
  form: FormData,
): Promise<WarehouseActionResult> {
  const parsed = parseWarehouseForm(form);
  if (!parsed.ok) return { ok: false, message: parsed.error };

  try {
    await apiCall(endpoints.createWarehouse(), {
      method: 'POST',
      auth: true,
      tenantId,
      body: parsed.value,
    });

    revalidatePath('/seller/warehouses');
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    return { ok: false, message: 'Could not save that warehouse. Try again in a moment.' };
  }
}
