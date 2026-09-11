/**
 * Parsing the review form, away from the Server Action that submits it.
 *
 * The same split `warehouse-form.ts` uses, for the same reason: `apps/web`
 * tests run in the node environment with no DOM, so the only way a form's rules
 * get asserted is if they live in a pure function over a `FormData` the test
 * can build by hand. An action that parsed inline would be untestable here and
 * would get its coverage from an E2E run instead - thirty seconds a case rather
 * than a millisecond.
 */

export type ReviewFields = {
  rating: number;
  title: string;
  body: string;
};

export type ParsedReview =
  | { ok: true; value: ReviewFields }
  | { ok: false; error: string };

export function parseReviewForm(form: FormData): ParsedReview {
  /**
   * `FormData.get` returns `File | string | null`, which is why this is a type
   * guard rather than a `String(...)`. Stringifying a File yields
   * "[object File]" - a value that would sail past a length check and reach the
   * API as a title nobody typed.
   */
  const rating = Number.parseInt(text(form, 'rating'), 10);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    // The form disables its own submit button until a star is picked, so this
    // is the case where somebody posted without one - a message, not a crash.
    return { ok: false, error: 'Choose a rating from one to five stars.' };
  }

  const title = text(form, 'title');
  if (title.length > 160) {
    return { ok: false, error: 'A headline has to fit in 160 characters.' };
  }

  const body = text(form, 'body');
  if (body.length > 4_000) {
    return { ok: false, error: 'A review has to fit in 4,000 characters.' };
  }

  // BOTH OPTIONAL, deliberately. Forcing a headline out of somebody who wants
  // to say "arrived bent" produces worse headlines, not better ones, and a
  // rating on its own is still the number the aggregate needs.
  return { ok: true, value: { rating, title, body } };
}

function text(form: FormData, key: string): string {
  const raw = form.get(key);
  return typeof raw === 'string' ? raw.trim() : '';
}
