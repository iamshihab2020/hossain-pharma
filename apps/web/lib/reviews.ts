import type { RatingSummary, Review } from '@nexmarket/api-client';

/**
 * View helpers for the trust surfaces. Phase 7.
 *
 * Pure functions over plain values, because `apps/web` renders server
 * components and those cannot be meaningfully driven by a DOM testing library.
 * The convention this repo settled in Phase 5 is that anything worth asserting
 * lives here and the component is left with markup - see
 * `order-timeline.test.ts` for the reasoning in full.
 */

/** How a rating reads in one line, with the null case spelled out. */
export function ratingLabel(summary: RatingSummary): string {
  if (summary.average === null) return 'No reviews yet';
  return `${summary.average.toFixed(1)} out of 5`;
}

/**
 * The count, as a sentence rather than a number in brackets.
 *
 * "1 review" and "12 reviews", never "12 review(s)" - a parenthesis in running
 * text is a developer asking the reader to do the grammar.
 */
export function reviewCountLabel(total: number): string {
  if (total === 0) return 'Be the first to review this';
  return total === 1 ? '1 review' : `${String(total)} reviews`;
}

/**
 * Whole and half stars for a display row, from an average.
 *
 * Halves rather than fractional widths because a half-star is what people read
 * a rating in - 4.3 shows as four and a half, not as 4.3 stars' worth of
 * yellow. Rounding to the nearest half is the same convention every storefront
 * uses, and `ratingLabel` carries the exact figure beside it for anyone who
 * wants the number.
 */
export function starRow(average: number | null): ('full' | 'half' | 'empty')[] {
  if (average === null) return ['empty', 'empty', 'empty', 'empty', 'empty'];

  const halves = Math.round(average * 2);
  return [1, 2, 3, 4, 5].map((position) => {
    if (halves >= position * 2) return 'full';
    return halves === position * 2 - 1 ? 'half' : 'empty';
  });
}

/**
 * A review's own heading: the title if it has one, else its first words.
 *
 * A review with no title is normal - the form makes it optional on purpose,
 * because forcing a headline out of somebody who just wants to say "arrived
 * bent" produces worse headlines, not better ones. An empty <h4> is worse
 * again, so this borrows the opening of the body.
 */
export function reviewHeading(review: Pick<Review, 'title' | 'body'>): string {
  const title = review.title.trim();
  if (title !== '') return title;

  const body = review.body.trim();
  if (body === '') return 'Rated without a comment';

  const firstSentence = body.split(/(?<=[.!?])\s/)[0] ?? body;
  return firstSentence.length > 70 ? `${firstSentence.slice(0, 67).trimEnd()}...` : firstSentence;
}

/**
 * Whether a review is one the seller disputes, from the reader's side.
 *
 * FLAGGED reviews are still on the page - a report is an accusation, not a
 * verdict - and showing that a review is under review is more honest than
 * silently leaving it to look like every other one. It is not a warning about
 * the AUTHOR: the label says the content has been reported, not that it is
 * false.
 */
export function isUnderReview(review: Pick<Review, 'status'>): boolean {
  return review.status === 'FLAGGED';
}

/**
 * The bars, widened so the tallest one fills the track.
 *
 * `share` is the true percentage and is what the number beside each bar says;
 * this is the DRAWN width. On a product with four 5-star reviews and one 4-star
 * the shares are 80 and 20, and drawing them at 80% and 20% of the track wastes
 * the fifth of the chart nothing ever reaches. Scaling to the mode is what
 * makes a histogram readable, and the percentage stays printed beside it so
 * nothing is being hidden.
 */
export function scaledBars(
  summary: RatingSummary,
): { stars: number; count: number; share: number; width: number }[] {
  const peak = Math.max(...summary.distribution.map((bar) => bar.count), 0);

  return summary.distribution.map((bar) => ({
    ...bar,
    width: peak === 0 ? 0 : Math.round((bar.count / peak) * 100),
  }));
}
