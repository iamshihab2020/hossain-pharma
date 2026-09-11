import type { RatingSummary } from '@nexmarket/api-client';
import { describe, expect, it } from 'vitest';
import {
  isUnderReview,
  ratingLabel,
  reviewCountLabel,
  reviewHeading,
  scaledBars,
  starRow,
} from './reviews';

function summaryOf(counts: [number, number, number, number, number]): RatingSummary {
  const total = counts.reduce((sum, n) => sum + n, 0);
  const weighted = counts.reduce((sum, n, index) => sum + n * (index + 1), 0);
  return {
    average: total === 0 ? null : weighted / total,
    total,
    distribution: [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: counts[stars - 1] ?? 0,
      share: total === 0 ? 0 : Math.round(((counts[stars - 1] ?? 0) / total) * 100),
    })),
  };
}

describe('ratingLabel', () => {
  it('says NO REVIEWS rather than showing a zero', () => {
    // "0.0 out of 5" is a claim about a product nobody has judged, and it is
    // the wrong one. The API returns null for exactly this reason.
    expect(ratingLabel(summaryOf([0, 0, 0, 0, 0]))).toBe('No reviews yet');
  });

  it('shows one decimal place', () => {
    expect(ratingLabel(summaryOf([0, 0, 0, 2, 1]))).toBe('4.3 out of 5');
  });
});

describe('reviewCountLabel', () => {
  it('invites the first review rather than printing a zero', () => {
    expect(reviewCountLabel(0)).toBe('Be the first to review this');
  });

  it('gets the grammar right at one', () => {
    expect(reviewCountLabel(1)).toBe('1 review');
    expect(reviewCountLabel(2)).toBe('2 reviews');
  });
});

describe('starRow', () => {
  it('is five empties for an unrated product', () => {
    expect(starRow(null)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
  });

  it('fills whole stars', () => {
    expect(starRow(4)).toEqual(['full', 'full', 'full', 'full', 'empty']);
  });

  it('rounds to the nearest HALF, which is how people read a rating', () => {
    // 4.3 is four and a half, not 4.3 stars' worth of yellow. The exact figure
    // is printed beside it by `ratingLabel`.
    expect(starRow(4.3)).toEqual(['full', 'full', 'full', 'full', 'half']);
    expect(starRow(4.2)).toEqual(['full', 'full', 'full', 'full', 'empty']);
    expect(starRow(4.8)).toEqual(['full', 'full', 'full', 'full', 'full']);
  });

  it('handles the extremes', () => {
    expect(starRow(5)).toEqual(['full', 'full', 'full', 'full', 'full']);
    expect(starRow(1)).toEqual(['full', 'empty', 'empty', 'empty', 'empty']);
  });
});

describe('reviewHeading', () => {
  it('uses the title when there is one', () => {
    expect(reviewHeading({ title: 'Solid build', body: 'Anything' })).toBe('Solid build');
  });

  it('borrows the first sentence when there is not', () => {
    // The form makes a title optional deliberately - forcing a headline out of
    // somebody who wants to say "arrived bent" produces worse headlines.
    expect(reviewHeading({ title: '', body: 'Arrived bent. Seller replaced it.' })).toBe(
      'Arrived bent.',
    );
  });

  it('truncates a long opening rather than running across the card', () => {
    const long = `${'word '.repeat(30)}end.`;
    const heading = reviewHeading({ title: '', body: long });
    expect(heading.endsWith('...')).toBe(true);
    expect(heading.length).toBeLessThanOrEqual(70);
  });

  it('says so when somebody rated without writing anything', () => {
    // Common and legitimate. An empty heading would be worse than naming it.
    expect(reviewHeading({ title: '   ', body: '  ' })).toBe('Rated without a comment');
  });
});

describe('isUnderReview', () => {
  it('marks a flagged review, which is still on the page', () => {
    expect(isUnderReview({ status: 'FLAGGED' })).toBe(true);
    expect(isUnderReview({ status: 'PUBLISHED' })).toBe(false);
  });
});

describe('scaledBars', () => {
  it('draws the tallest bar full width while keeping the true percentage', () => {
    /**
     * Four 5s and one 4: the shares are 80 and 20, and drawing them at those
     * widths wastes the fifth of the chart nothing ever reaches. The width is
     * scaled to the mode; the share is what gets printed.
     */
    const bars = scaledBars(summaryOf([0, 0, 0, 1, 4]));
    const five = bars.find((bar) => bar.stars === 5);
    const four = bars.find((bar) => bar.stars === 4);

    expect(five).toMatchObject({ count: 4, share: 80, width: 100 });
    expect(four).toMatchObject({ count: 1, share: 20, width: 25 });
  });

  it('draws nothing at all when there are no reviews', () => {
    // Rather than dividing by zero and rendering five NaN-wide bars.
    expect(scaledBars(summaryOf([0, 0, 0, 0, 0])).every((bar) => bar.width === 0)).toBe(true);
  });
});
