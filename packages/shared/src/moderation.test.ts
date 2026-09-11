import { describe, expect, it } from 'vitest';
import {
  autoFlagReasons,
  containsFlaggedWord,
  containsLink,
  exceedsReviewVelocity,
  hasRepetition,
  REVIEW_VELOCITY_WINDOW_MS,
} from './moderation.js';

describe('containsFlaggedWord', () => {
  it('catches a word from the list, whatever the case', () => {
    expect(containsFlaggedWord('this is a SCAM')).toBe(true);
    expect(containsFlaggedWord('counterfeit goods')).toBe(true);
  });

  it('leaves ordinary text alone', () => {
    expect(containsFlaggedWord('Arrived on time and works well.')).toBe(false);
  });

  it('matches WHOLE WORDS, which is the Scunthorpe rule', () => {
    /**
     * A substring match flags `classic` for containing `ass`, and a filter that
     * fires on innocent text is one people learn to overrule without reading.
     * `fake` is on the list; `fakery` and `snowflake` are not it.
     */
    expect(containsFlaggedWord('snowflake pattern')).toBe(false);
    expect(containsFlaggedWord('fakery')).toBe(false);
    expect(containsFlaggedWord('it is fake')).toBe(true);
  });
});

describe('containsLink', () => {
  it('catches a URL', () => {
    expect(containsLink('buy at https://cheap.example/x')).toBe(true);
    expect(containsLink('see www.cheap.example')).toBe(true);
  });

  it('catches a BARE DOMAIN, because that is the same advert', () => {
    expect(containsLink('order from cheapstuff.shop instead')).toBe(true);
  });

  it('leaves a review with no link alone', () => {
    // A genuine review of a kettle has no reason to carry a URL, which is why
    // this is the most reliable signal here - but it must not fire on prose.
    expect(containsLink('Boils fast. No complaints at all.')).toBe(false);
  });

  it('does not read an ordinary sentence ending as a domain', () => {
    expect(containsLink('It works. Well made.')).toBe(false);
  });
});

describe('hasRepetition', () => {
  it('catches padding', () => {
    expect(hasRepetition('goooooooooood')).toBe(true);
    expect(hasRepetition('!!!!!!!!!!!!')).toBe(true);
  });

  it('leaves enthusiasm alone', () => {
    // Three exclamation marks is a person, not a bot.
    expect(hasRepetition('Great!!!')).toBe(false);
    expect(hasRepetition('Sooo good')).toBe(false);
  });
});

describe('exceedsReviewVelocity', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  const minutesAgo = (n: number): Date => new Date(now.getTime() - n * 60_000);

  it('fires on a burst inside the window', () => {
    expect(exceedsReviewVelocity([minutesAgo(1), minutesAgo(2), minutesAgo(3)], now)).toBe(true);
  });

  it('ignores reviews that fell out of the window', () => {
    // A person catching up on a month of shopping is not a review ring, and the
    // window is the only thing that tells them apart.
    expect(exceedsReviewVelocity([minutesAgo(30), minutesAgo(40), minutesAgo(50)], now)).toBe(
      false,
    );
  });

  it('is quiet for a first review', () => {
    expect(exceedsReviewVelocity([], now)).toBe(false);
  });

  it('counts the boundary as outside the window', () => {
    const edge = new Date(now.getTime() - REVIEW_VELOCITY_WINDOW_MS);
    expect(exceedsReviewVelocity([edge, edge, edge], now)).toBe(false);
  });

  it('takes an explicit limit and window', () => {
    // One review a minute old, a two-minute window, a limit of one. Not a
    // SIXTY-SECOND window: the cutoff is exclusive, so a timestamp exactly one
    // minute old sits outside it - which is the rule the test above pins down.
    expect(exceedsReviewVelocity([minutesAgo(1)], now, 1, 120_000)).toBe(true);
    expect(exceedsReviewVelocity([minutesAgo(5)], now, 1, 120_000)).toBe(false);
  });

  it('defaults `now` to the clock rather than requiring one', () => {
    expect(exceedsReviewVelocity([new Date()])).toBe(false);
  });
});

describe('autoFlagReasons', () => {
  const clean = { title: 'Good', body: 'Works well.', recentByAuthor: [] };

  it('says nothing about an ordinary review', () => {
    expect(autoFlagReasons(clean)).toEqual([]);
  });

  it('reads the TITLE as well as the body', () => {
    // A headline is the part a reader sees first, so a rule that only looked at
    // the body would miss the half that does the damage.
    expect(autoFlagReasons({ ...clean, title: 'total scam' })).toEqual(['profanity']);
  });

  it('returns EVERY reason, not the first', () => {
    /**
     * A moderator wants to know whether something tripped one rule or four.
     * "Contains a link" alone is usually a mistake; a link plus a flagged word
     * plus the author's fourth review this hour is not, and returning early
     * would throw away the only thing separating them.
     */
    const now = new Date('2026-09-11T12:00:00Z');
    const reasons = autoFlagReasons({
      title: 'scam',
      body: 'buy at cheap.shop insteaaaaaaaaaad',
      recentByAuthor: [now, now, now],
      now,
    });

    expect(reasons).toEqual(['profanity', 'links', 'repetition', 'velocity']);
  });
});
