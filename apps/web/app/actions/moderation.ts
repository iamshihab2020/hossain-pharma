'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { endpoints } from '@nexmarket/api-client';
import { ApiError, apiCall } from '@/lib/api/server';

export type ModerationResult = { ok: true } | { ok: false; message: string };

/**
 * A platform admin takes a review down, or clears it.
 *
 * `updateTag('catalogue')` rather than a path revalidation, because a removal
 * has to reach the PRODUCT page - the rating above the list changes, and that
 * page is cached by tag for a minute. Revalidating only this queue would leave
 * a removed review visible to every shopper until the cache expired, which is
 * "removes content from all surfaces" failing on the surface that matters most.
 */
export async function moderateReview(
  id: string,
  action: 'FLAG' | 'REMOVE' | 'RESTORE',
  reason: string,
): Promise<ModerationResult> {
  try {
    await apiCall(endpoints.moderateReview(id), {
      method: 'POST',
      auth: true,
      body: { action, reason },
    });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 403) return { ok: false, message: 'Platform admins only.' };
    if (error.status === 404) return { ok: false, message: 'That review is gone already.' };
    return { ok: false, message: 'That did not go through. Try again.' };
  }

  updateTag('catalogue');
  revalidatePath('/admin/reviews');
  return { ok: true };
}
