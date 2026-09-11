'use server';

import { updateTag } from 'next/cache';
import { endpoints, type Question } from '@nexmarket/api-client';
import { ApiError, apiCall } from '@/lib/api/server';
import { activeOrg } from '@/lib/api/queries';

export type QuestionResult =
  | { ok: true; question: Question }
  | { ok: false; message: string };

/**
 * Ask about a product you have not bought.
 *
 * The one place Phase 7's two features diverge in their input: a review names
 * an ORDER LINE and derives the product from it, while a question names the
 * product directly, because there is nothing to derive it from. That is not an
 * inconsistency - it is what "you can ask before buying" means when written
 * down.
 */
export async function askQuestion(productId: string, body: string): Promise<QuestionResult> {
  const text = body.trim();
  if (text.length < 5) {
    return { ok: false, message: 'Say a little more so somebody can answer it.' };
  }

  try {
    const { data } = await apiCall(endpoints.ask(), {
      method: 'POST',
      auth: true,
      body: { productId, body: text },
    });
    updateTag('catalogue');
    return { ok: true, question: data };
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }
}

/**
 * Answer, as yourself or as the seller you act for.
 *
 * The tenant header goes with the request when the caller has an acting
 * organisation, and the API VERIFIES it against `org_members` before recording
 * the answer as a seller's. Sending it is not what makes the badge true; the
 * membership check on the other side is.
 */
export async function answerQuestion(
  questionId: string,
  body: string,
): Promise<QuestionResult> {
  const text = body.trim();
  if (text === '') return { ok: false, message: 'Write an answer first.' };

  try {
    // `activeOrg()` answers null for somebody who sells nothing, which is most
    // people answering a question - and the API treats a missing tenant as "a
    // shopper replied" rather than as an error.
    const org = await activeOrg();
    const { data } = await apiCall(endpoints.answerQuestion(questionId), {
      method: 'POST',
      auth: true,
      ...(org === null ? {} : { tenantId: org.id }),
      body: { body: text },
    });
    updateTag('catalogue');
    return { ok: true, question: data };
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }
}

function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) throw error;
  if (error.status === 401 || error.status === 403) return 'Sign in to post.';
  if (error.status === 404) return 'That product is no longer listed.';
  return 'That did not go through. Try again.';
}
