'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Flag, ThumbsUp } from 'lucide-react';
import { markHelpful, reportReview } from '@/app/actions/reviews';
import { cn } from '@/lib/utils';

/**
 * The two things a READER can do to somebody else's review.
 *
 * Both deliberately quiet. A review card is somebody's words, and a row of
 * prominent buttons under every one turns a page of opinions into a page of
 * controls - the eye goes to the affordances rather than the content. These sit
 * at text size, in muted grey, and only the counts carry any weight.
 */
export function ReviewActions({
  reviewId,
  helpfulCount,
  productSlug,
}: {
  reviewId: string;
  helpfulCount: number;
  productSlug: string;
}): ReactNode {
  const [count, setCount] = useState(helpfulCount);
  const [voted, setVoted] = useState(false);
  const [reported, setReported] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function helpful(): void {
    setMessage(null);
    startTransition(async () => {
      const result = await markHelpful(reviewId);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      // The SERVER's count, not an optimistic increment. Somebody else may have
      // voted since this page rendered, and a number that disagrees with the
      // next reload is worse than one that arrives a moment later.
      setCount(result.helpfulCount);
      setVoted(result.voted);
    });
  }

  function report(): void {
    setMessage(null);
    startTransition(async () => {
      const result = await reportReview(reviewId, productSlug);
      if (result.ok) setReported(true);
      else setMessage(result.message);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <button
        type="button"
        onClick={helpful}
        disabled={pending}
        aria-pressed={voted}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          voted ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        <ThumbsUp className={cn('size-3.5', voted && 'fill-foreground')} aria-hidden />
        {/* The COUNT is the label, not a badge beside one. "Helpful (3)" reads
            as a control with a number attached; "3 found this helpful" is the
            fact a reader wants and the button is how you add to it. */}
        {count === 0 ? 'Helpful' : `${String(count)} found this helpful`}
      </button>

      {reported ? (
        <span className="text-muted-foreground">Reported — a moderator will look</span>
      ) : (
        <button
          type="button"
          onClick={report}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Flag className="size-3.5" aria-hidden />
          Report
        </button>
      )}

      {message !== null && (
        <span role="alert" className="text-warn">
          {message}
        </span>
      )}
    </div>
  );
}
