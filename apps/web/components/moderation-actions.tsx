'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { moderateReview } from '@/app/actions/moderation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Remove, or clear. The two verbs a moderator actually uses on a queue.
 *
 * FLAG is not here, though the API has it: everything on this screen is already
 * flagged, so a third button would do nothing from this page. It exists on the
 * endpoint for the case a moderator reaches a review from somewhere else.
 *
 * THE REASON IS REQUIRED, on both. Phase 11's audit log will want it, and a
 * queue whose history reads "removed, removed, removed" teaches the next person
 * nothing about where the line is. Making it mandatory on RESTORE too is
 * deliberate - "this reads as a genuine complaint" is the more useful note of
 * the two and the one nobody writes voluntarily.
 */
export function ModerationActions({ reviewId }: { reviewId: string }): ReactNode {
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<'REMOVE' | 'RESTORE' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done !== null) {
    return (
      <p className="text-sm text-success">
        {done === 'REMOVE' ? 'Removed from every surface.' : 'Cleared and back on the page.'}
      </p>
    );
  }

  const act = (action: 'REMOVE' | 'RESTORE'): void => {
    if (reason.trim() === '') {
      setError('Say why, so the next moderator knows where the line is.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await moderateReview(reviewId, action, reason.trim());
      if (result.ok) setDone(action);
      else setError(result.message);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`reason-${reviewId}`} className="sr-only">
          Reason
        </label>
        <Input
          id={`reason-${reviewId}`}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setError(null);
          }}
          placeholder="Why?"
          className="max-w-sm"
        />
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => {
            act('REMOVE');
          }}
        >
          {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />}
          Remove
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            act('RESTORE');
          }}
        >
          Clear it
        </Button>
      </div>

      {error !== null && (
        <p role="alert" className="text-xs text-warn">
          {error}
        </p>
      )}
    </div>
  );
}
