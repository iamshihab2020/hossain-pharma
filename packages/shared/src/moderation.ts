/**
 * Auto-flagging. PRD 9.6: "Auto-flagging: profanity, suspicious review
 * velocity, image checks."
 *
 * THESE RULES FLAG; THEY NEVER HIDE. Every one of them returns a reason to put
 * something in front of a human, and nothing here can remove content. That is
 * the same rule a reader's report follows and it matters more here, not less: a
 * word list is wrong often enough that letting it delete would make it a
 * censorship bug with a scheduler.
 *
 * WHAT THIS IS NOT. A twenty-word list is a demonstration of the seam, not a
 * profanity filter - real ones are a service, they are localised, and they lose
 * to `f u c k` and to every language this list is not written in. The value
 * here is that the seam exists and is tested, so replacing the implementation
 * is one file. Anything claiming more would be claiming something false.
 *
 * Framework-free and database-free, like everything else in this package, so
 * the same functions run at write time in the API and in a test in a
 * millisecond.
 */

export type AutoFlagReason =
  | 'profanity'
  | 'links'
  | 'velocity'
  | 'repetition';

/**
 * Deliberately small, deliberately English, and deliberately mild.
 *
 * Long enough to prove the rule fires, short enough that nobody mistakes it for
 * coverage. Mild because a list used in tests and printed in failure output
 * should not be a reason someone cannot read a CI log at their desk.
 */
const FLAGGED_WORDS: readonly string[] = [
  'scam',
  'fraud',
  'counterfeit',
  'fake',
  'stolen',
  'ripoff',
];

/**
 * Whole words only.
 *
 * "Scunthorpe" is the standing joke and the standing bug: a substring match
 * flags `classic` for containing `ass`, and a filter that fires on innocent
 * text is a filter people learn to overrule without reading. Word boundaries
 * are the cheapest thing that stops it.
 */
export function containsFlaggedWord(text: string): boolean {
  const haystack = text.toLowerCase();
  return FLAGGED_WORDS.some((word) =>
    new RegExp(`\\b${word}\\b`, 'u').test(haystack),
  );
}

/**
 * A link in a review, which on a marketplace is almost always an advert.
 *
 * The single most reliable signal available without a model: a genuine review
 * of a kettle has no reason to carry a URL, and a paid one usually does. Bare
 * domains count, because "buy at cheapstuff dot example" and
 * "cheapstuff.example" are the same post.
 */
export function containsLink(text: string): boolean {
  return /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|shop|xyz)\b/iu.test(
    text,
  );
}

/**
 * The same character over and over - "AAAAAAAAAA", "!!!!!!!!!!".
 *
 * Not a judgement about enthusiasm. Ten identical characters in a row is what
 * padding looks like when somebody needs to clear a minimum length, and it is
 * one of the few shapes that is nearly always noise in any language, which is
 * more than the word list above can say for itself.
 */
export function hasRepetition(text: string): boolean {
  return /(.)\1{9,}/u.test(text);
}

export const REVIEW_VELOCITY_LIMIT = 3;
export const REVIEW_VELOCITY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Too many reviews from one person too quickly.
 *
 * PRD 9.6's "suspicious review velocity". Every review still needs its own
 * delivered purchase, so this cannot be a stranger spraying the catalogue - it
 * is somebody working through a pile of orders, which is either a review ring
 * or a person catching up on a month of shopping. Those look identical from
 * here, which is exactly why this flags rather than blocks.
 *
 * Takes the timestamps rather than a count, so the caller cannot accidentally
 * pass a lifetime total and have it read as a burst.
 */
export function exceedsReviewVelocity(
  recent: readonly Date[],
  now: Date = new Date(),
  limit: number = REVIEW_VELOCITY_LIMIT,
  windowMs: number = REVIEW_VELOCITY_WINDOW_MS,
): boolean {
  const cutoff = now.getTime() - windowMs;
  const inWindow = recent.filter((at) => at.getTime() > cutoff).length;
  return inWindow >= limit;
}

export type AutoFlagInput = {
  readonly title: string;
  readonly body: string;
  /** When this author's other reviews were written. Empty for a first review. */
  readonly recentByAuthor: readonly Date[];
  readonly now?: Date;
};

/**
 * Every reason to put this in front of a human, or an empty list.
 *
 * EVERY reason, not the first one. A moderator reading a queue wants to know
 * whether something tripped one rule or four, because "contains a link" alone
 * is usually a mistake and "link, plus a word from the list, plus the author's
 * fourth review this hour" is not. Returning early would throw away the only
 * signal that separates those two.
 */
export function autoFlagReasons(input: AutoFlagInput): AutoFlagReason[] {
  const text = `${input.title} ${input.body}`;
  const reasons: AutoFlagReason[] = [];

  if (containsFlaggedWord(text)) reasons.push('profanity');
  if (containsLink(text)) reasons.push('links');
  if (hasRepetition(text)) reasons.push('repetition');
  if (exceedsReviewVelocity(input.recentByAuthor, input.now)) reasons.push('velocity');

  return reasons;
}
