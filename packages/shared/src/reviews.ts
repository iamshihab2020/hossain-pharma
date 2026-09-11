/**
 * Rating arithmetic. Phase 7, PRD 9.5 ("aggregated rating, review distribution
 * histogram") and 8.3, whose buy box has ranked on `sellerRating` since Phase 2
 * with nothing to put in it.
 *
 * THE HISTOGRAM IS THE VALUE, and everything else is derived from it. Five
 * integers describe a rating completely - the count, the average and every bar
 * on the distribution chart fall out of them - so storing an average beside the
 * counts would be a second source of truth for one fact. This codebase has been
 * bitten twice by a denormalised column with two writers; the cheapest way not
 * to be bitten a third time is for the second column not to exist.
 *
 * Framework-free and database-free, like everything else here, so the same
 * functions serve the aggregate writer, the product page and the buy box.
 */

/** Counts of 1★ through 5★, in that order. */
export type RatingHistogram = readonly [number, number, number, number, number];

export const MIN_RATING = 1;
export const MAX_RATING = 5;

export function emptyHistogram(): RatingHistogram {
  return [0, 0, 0, 0, 0];
}

/**
 * A histogram from raw stars.
 *
 * THROWS on a rating outside 1-5 rather than skipping it. The database carries
 * the same range as a CHECK constraint, so a value arriving here out of range
 * means something wrote around the constraint - and an aggregate that quietly
 * drops it would report a smaller, wrong total with nothing to show for the
 * discrepancy.
 */
export function histogramFrom(ratings: Iterable<number>): RatingHistogram {
  // FIVE NAMED ACCUMULATORS rather than `counts[rating - 1] += 1`. Under
  // `noUncheckedIndexedAccess` that read is `number | undefined`, and the `?? 0`
  // that silences it is a branch the range check above has already made
  // unreachable - the same thing `countFor` is avoiding, for the same reason.
  let one = 0;
  let two = 0;
  let three = 0;
  let four = 0;
  let five = 0;

  for (const rating of ratings) {
    if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
      throw new RangeError(`Rating ${String(rating)} is outside ${MIN_RATING}-${MAX_RATING}`);
    }
    switch (rating) {
      case 1:
        one += 1;
        break;
      case 2:
        two += 1;
        break;
      case 3:
        three += 1;
        break;
      case 4:
        four += 1;
        break;
      default:
        five += 1;
        break;
    }
  }

  return [one, two, three, four, five];
}

/** How many reviews the histogram summarises. */
export function totalReviews(histogram: RatingHistogram): number {
  return histogram.reduce((sum, count) => sum + count, 0);
}

/**
 * The mean, or NULL where nobody has reviewed yet.
 *
 * Null rather than 0, because those are different facts and the buy box already
 * knows it: `sellerRating` is `number | null` and an unrated seller sorts
 * behind a rated one rather than below a one-star. A zero would rank a brand
 * new seller as the worst on the page.
 *
 * A float, and that is fine here in a way it would not be in a money path. A
 * rating is never summed into a balance; it is compared and it is displayed, and
 * both survive the last bit of a double. `Money` exists because 0.1 + 0.2 ends
 * up in somebody's bank account, which is not true of 4.3 stars.
 */
export function averageRating(histogram: RatingHistogram): number | null {
  const total = totalReviews(histogram);
  if (total === 0) return null;

  const sum = histogram.reduce((acc, count, index) => acc + count * (index + 1), 0);
  return sum / total;
}

/** The average as a page shows it: one decimal place, or null when unrated. */
export function displayAverage(histogram: RatingHistogram): number | null {
  const average = averageRating(histogram);
  return average === null ? null : Math.round(average * 10) / 10;
}

/**
 * One bar's share of the distribution, 0-100, rounded to a whole percent.
 *
 * Rounded per bar rather than allocated across all five, so the bars can sum to
 * 99 or 101. That is correct for a chart and wrong for money, which is why
 * `allocate()` exists for the other case: a percent here is a visual weight, and
 * forcing five bars to total exactly 100 would move a bar to make a number
 * tidy that nobody reads.
 */
export function ratingShare(histogram: RatingHistogram, stars: number): number {
  if (!Number.isInteger(stars) || stars < MIN_RATING || stars > MAX_RATING) {
    throw new RangeError(`Stars ${String(stars)} is outside ${MIN_RATING}-${MAX_RATING}`);
  }

  const total = totalReviews(histogram);
  if (total === 0) return 0;

  return Math.round((countFor(histogram, stars) / total) * 100);
}

/**
 * One bucket, by its star value.
 *
 * A switch over a DESTRUCTURED tuple rather than `histogram[stars - 1]`. Under
 * `noUncheckedIndexedAccess` an indexed read is `number | undefined`, and the
 * `?? 0` that silences it is a branch nothing can reach - both callers validate
 * the range first. The convention here is to delete an unreachable branch
 * rather than write a test that pretends to cover it; destructuring a
 * fixed-length tuple gives five plain numbers and the question stops existing.
 */
function countFor(histogram: RatingHistogram, stars: number): number {
  const [one, two, three, four, five] = histogram;
  switch (stars) {
    case 1:
      return one;
    case 2:
      return two;
    case 3:
      return three;
    case 4:
      return four;
    default:
      return five;
  }
}

/**
 * The bars a distribution chart renders, highest star first.
 *
 * Descending because that is the order every rating histogram on the internet
 * uses, and a buyer scanning one is looking for how much of it is at the top.
 */
export function distribution(
  histogram: RatingHistogram,
): { stars: number; count: number; share: number }[] {
  return [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: countFor(histogram, stars),
    share: ratingShare(histogram, stars),
  }));
}
