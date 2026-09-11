import { describe, expect, it } from 'vitest';
import {
  averageRating,
  displayAverage,
  distribution,
  emptyHistogram,
  histogramFrom,
  ratingShare,
  totalReviews,
  type RatingHistogram,
} from './reviews.js';

describe('histogramFrom', () => {
  it('counts stars into their own buckets', () => {
    expect(histogramFrom([5, 5, 4, 1])).toEqual([1, 0, 0, 1, 2]);
  });

  it('has a bucket for every star, including the middle three', () => {
    // All five, because the counter branches per value and a test that only
    // ever sends 1, 4 and 5 leaves two of those branches unproven.
    expect(histogramFrom([1, 2, 3, 4, 5])).toEqual([1, 1, 1, 1, 1]);
  });

  it('is empty for no ratings at all', () => {
    expect(histogramFrom([])).toEqual(emptyHistogram());
  });

  it('THROWS on a star outside the range rather than skipping it', () => {
    // The column carries the same range as a CHECK constraint, so a value
    // arriving here out of range means something wrote around it. Dropping it
    // silently would report a smaller total with nothing to explain the gap.
    expect(() => histogramFrom([0])).toThrow(RangeError);
    expect(() => histogramFrom([6])).toThrow(RangeError);
    expect(() => histogramFrom([-1])).toThrow(RangeError);
  });

  it('throws on a fractional star, which no interface can produce', () => {
    expect(() => histogramFrom([4.5])).toThrow(RangeError);
  });
});

describe('totalReviews', () => {
  it('sums every bucket', () => {
    expect(totalReviews([1, 2, 3, 4, 5])).toBe(15);
  });

  it('is zero for an empty histogram', () => {
    expect(totalReviews(emptyHistogram())).toBe(0);
  });
});

describe('averageRating', () => {
  it('weights each bucket by its stars', () => {
    // Two 5s and two 1s average 3, not 5.
    expect(averageRating([2, 0, 0, 0, 2])).toBe(3);
  });

  it('is NULL with no reviews, never zero', () => {
    /**
     * Different facts, and the buy box already depends on the difference:
     * `sellerRating` is `number | null` and an unrated seller sorts BEHIND a
     * rated one rather than below a one-star. Zero would rank every new seller
     * as the worst offer on the page.
     */
    expect(averageRating(emptyHistogram())).toBeNull();
  });

  it('does not round - the caller decides', () => {
    // 4, 4, 5 is 4.333..., and the ranking key wants the whole number.
    expect(averageRating([0, 0, 0, 2, 1])).toBeCloseTo(13 / 3, 10);
  });

  it('handles a single review', () => {
    expect(averageRating([0, 0, 1, 0, 0])).toBe(3);
  });
});

describe('displayAverage', () => {
  it('rounds to one decimal place', () => {
    expect(displayAverage([0, 0, 0, 2, 1])).toBe(4.3);
  });

  it('keeps a whole number whole', () => {
    expect(displayAverage([0, 0, 0, 0, 3])).toBe(5);
  });

  it('is null when there is nothing to average', () => {
    expect(displayAverage(emptyHistogram())).toBeNull();
  });
});

describe('ratingShare', () => {
  it('gives each bar its percentage', () => {
    const histogram: RatingHistogram = [1, 0, 0, 1, 2];
    expect(ratingShare(histogram, 5)).toBe(50);
    expect(ratingShare(histogram, 4)).toBe(25);
    expect(ratingShare(histogram, 1)).toBe(25);
    expect(ratingShare(histogram, 3)).toBe(0);
  });

  it('is zero everywhere when nobody has reviewed', () => {
    expect(ratingShare(emptyHistogram(), 5)).toBe(0);
  });

  it('rounds PER BAR, so the bars need not total 100', () => {
    // Three reviews, one each at 5, 4 and 3: 33 + 33 + 33 = 99. Correct for a
    // chart. `allocate()` exists for the case where the last unit must land
    // somewhere, and that case is money.
    const thirds: RatingHistogram = [0, 0, 1, 1, 1];
    const total = [5, 4, 3].reduce((sum, stars) => sum + ratingShare(thirds, stars), 0);
    expect(total).toBe(99);
  });

  it('refuses a star outside the range', () => {
    expect(() => ratingShare(emptyHistogram(), 0)).toThrow(RangeError);
    expect(() => ratingShare(emptyHistogram(), 6)).toThrow(RangeError);
    expect(() => ratingShare(emptyHistogram(), 2.5)).toThrow(RangeError);
  });
});

describe('distribution', () => {
  it('runs highest star FIRST, the way every rating chart does', () => {
    expect(distribution([1, 0, 0, 1, 2]).map((bar) => bar.stars)).toEqual([5, 4, 3, 2, 1]);
  });

  it('carries the count and the share on each bar', () => {
    expect(distribution([1, 0, 0, 1, 2])[0]).toEqual({ stars: 5, count: 2, share: 50 });
  });

  it('renders an unrated product as five empty bars, not as nothing', () => {
    const bars = distribution(emptyHistogram());
    expect(bars).toHaveLength(5);
    expect(bars.every((bar) => bar.count === 0 && bar.share === 0)).toBe(true);
  });
});
