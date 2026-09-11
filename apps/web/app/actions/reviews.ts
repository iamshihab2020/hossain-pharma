'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { endpoints } from '@nexmarket/api-client';
import { ApiError, apiCall } from '@/lib/api/server';
import { parseReviewForm } from '@/lib/review-form';

export type ReviewResult = { ok: true } | { ok: false; message: string };
export type HelpfulResult =
  | { ok: true; helpfulCount: number; voted: boolean }
  | { ok: false; message: string };

/**
 * Writing a review, from the buyer's own order.
 *
 * The order line id is the ONLY thing identifying what is being reviewed - no
 * product id crosses this boundary, because the server derives the product from
 * the purchase. A form that posted both would let a caller review one thing on
 * the strength of having bought another, and the verified-purchase guarantee is
 * exactly what would be worthless.
 *
 * The stars are parsed here rather than trusted from the form: a `FormData`
 * value is a string, and `Number('')` is 0, which the API would answer with a
 * 400 the buyer cannot act on.
 */
export async function writeReview(
  orderItemId: string,
  form: FormData,
  photos: readonly { contentType: string; base64: string }[] = [],
): Promise<ReviewResult> {
  const parsed = parseReviewForm(form);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const { rating, title, body } = parsed.value;

  let reviewId: string;
  try {
    const { data } = await apiCall(endpoints.myReviews(), {
      method: 'POST',
      auth: true,
      body: {
        orderItemId,
        rating,
        ...(title === '' ? {} : { title }),
        ...(body === '' ? {} : { body }),
      },
    });
    reviewId = data.id;
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }

  /**
   * PHOTOS AFTER THE REVIEW, because a photo needs a review to hang off.
   *
   * SEQUENTIALLY, not in parallel: the API assigns each photo the next position
   * by counting the ones already stored, so four concurrent uploads would all
   * read zero and land on top of each other. One at a time is four round trips
   * for the rare review that has four photos, and correct ordering for all of
   * them.
   *
   * A failure here does NOT fail the review. The words are the valuable part
   * and they are already saved; telling somebody their review did not post
   * because the third picture timed out would be a lie about what happened.
   */
  for (const photo of photos) {
    const attached = await attachPhoto(reviewId, photo.contentType, photo.base64);
    if (!attached.ok) break;
  }

  /**
   * The PRODUCT page's cache, not just this one.
   *
   * A review changes the rating a stranger sees, and the catalogue is cached by
   * tag for a minute. Revalidating only `/reviews` would leave the product page
   * showing yesterday's average while the buyer who just wrote it sees their
   * own review missing from it - the kind of inconsistency that reads as a lost
   * write.
   */
  updateTag('catalogue');

  /**
   * A REDIRECT CARRIES THE CONFIRMATION, not client state in the form.
   *
   * A Server Action refreshes the route it was called from, always - so the
   * list this form is standing in re-renders without the line that was just
   * reviewed, and the form unmounts. Any "thank you" it set immediately
   * afterwards paints into a component that no longer exists: the buyer saw the
   * whole section replaced by "Nothing waiting" and no acknowledgement at all.
   * It was unreachable code, and the E2E journey is what noticed.
   *
   * The fix is the pattern checkout already uses - it redirects to
   * `/orders?placed=NM-...` rather than trying to hold a success flag across
   * the same refresh. Same shape here.
   *
   * OUTSIDE the try: `redirect` works by throwing, and catching it would turn a
   * successful post into "that did not go through".
   */
  redirect('/reviews?posted=1');
}

/** Edit your own words. Same revalidation, same reason. */
export async function editReview(id: string, form: FormData): Promise<ReviewResult> {
  const parsed = parseReviewForm(form);
  if (!parsed.ok) return { ok: false, message: parsed.error };

  try {
    await apiCall(endpoints.myReview(id), {
      method: 'PATCH',
      auth: true,
      body: parsed.value,
    });
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }

  updateTag('catalogue');
  revalidatePath('/reviews');
  return { ok: true };
}

export async function deleteReview(id: string): Promise<ReviewResult> {
  try {
    await apiCall(endpoints.myReview(id), { method: 'DELETE', auth: true });
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }

  updateTag('catalogue');
  revalidatePath('/reviews');
  return { ok: true };
}

/**
 * "I found this helpful", and pressing it again takes it back.
 *
 * Returns the SERVER's count rather than letting the component increment.
 * Somebody else may have voted since the page rendered, and a number that
 * disagrees with the next reload is worse than one that arrives a moment later.
 *
 * No revalidation. The count lives in one component on a page that is otherwise
 * cached catalogue content, and blowing the product page's cache for a vote
 * would make every reader re-render the whole comparison table to move a number
 * only the voter is looking at.
 */
export async function markHelpful(id: string): Promise<HelpfulResult> {
  try {
    const { data } = await apiCall(endpoints.helpfulReview(id), {
      method: 'POST',
      auth: true,
      body: {},
    });
    return { ok: true, helpfulCount: data.helpfulCount, voted: data.voted };
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }
}

/**
 * A photo on a review the buyer just wrote.
 *
 * Base64 over JSON, the same shape product media uses: Fastify would need a
 * multipart parser registered for one route, and a phone photo does not need
 * streaming. Read in the browser rather than here, because a Server Action
 * receiving a `File` would buffer it twice.
 */
export async function attachPhoto(
  reviewId: string,
  contentType: string,
  contentBase64: string,
): Promise<ReviewResult> {
  try {
    await apiCall(endpoints.addReviewPhoto(reviewId), {
      method: 'POST',
      auth: true,
      body: { contentType, contentBase64 },
    });
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }

  updateTag('catalogue');
  return { ok: true };
}

/**
 * Reporting somebody else's review.
 *
 * No auth, matching the endpoint: requiring an account to report abuse means
 * the abuse stays up while the person who noticed it registers, and the people
 * best placed to spot a fake review are shoppers reading the page.
 */
export async function reportReview(id: string, productSlug: string): Promise<ReviewResult> {
  try {
    await apiCall(endpoints.reportReview(id), { method: 'POST', auth: false, body: {} });
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }

  revalidatePath(`/p/${productSlug}`);
  return { ok: true };
}

/**
 * What the buyer should read, rather than what the API said.
 *
 * The 404 is the interesting one: the API answers identically for "no such
 * line", "somebody else's line" and "not delivered yet", because telling them
 * apart tells a stranger which orders exist. From inside the buyer's own page
 * only the third is reachable, so that is what the message says.
 */
function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) throw error;
  /* 409 covers two different things now - a second review of one purchase, and
     an author trying to boost their own. The API's own message says which, and
     `ApiError` keeps it on `message`. */
  if (error.status === 409) return error.message;
  if (error.status === 404) return 'This order has not arrived yet, so it cannot be reviewed.';
  if (error.status === 401) return 'Sign in first.';
  if (error.status === 403) return 'Sign in first.';
  return 'That did not go through. Try again.';
}
