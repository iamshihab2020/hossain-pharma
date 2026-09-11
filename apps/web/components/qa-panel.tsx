'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { Question } from '@nexmarket/api-client';
import { answerQuestion, askQuestion } from '@/app/actions/questions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatDate } from '@/lib/format';

/**
 * Product Q&A. PRD 9.5.
 *
 * A CLIENT ISLAND, unlike the review panel, because asking and answering both
 * happen in place and a reader who has just asked should see their question
 * without a navigation. Reviews are written somewhere else entirely - on the
 * order that proves the purchase - so that panel stays a server component.
 *
 * OLDEST FIRST, which the API decides and this preserves. A Q&A section is a
 * growing FAQ rather than a feed: the question everyone has is usually the one
 * somebody asked first, and burying it under today's makes every later reader
 * scroll past what the person before them already had answered.
 */
export function QaPanel({
  productId,
  initial,
  signedIn,
}: {
  productId: string;
  initial: readonly Question[];
  signedIn: boolean;
}): ReactNode {
  const [questions, setQuestions] = useState<readonly Question[]>(initial);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(): void {
    setError(null);
    startTransition(async () => {
      const result = await askQuestion(productId, body);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setQuestions([...questions, result.question]);
      setBody('');
    });
  }

  return (
    <section className="mt-12 border-t pt-8" aria-labelledby="qa-heading">
      <h2 id="qa-heading" className="text-lg font-semibold">
        Questions about this product
      </h2>

      {questions.length === 0 ? (
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          Nobody has asked anything yet.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-7">
          {questions.map((question) => (
            <li key={question.id}>
              <QuestionCard
                question={question}
                signedIn={signedIn}
                onAnswered={(updated) => {
                  setQuestions(questions.map((q) => (q.id === updated.id ? updated : q)));
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {signedIn ? (
        <div className="mt-8 flex max-w-xl flex-col gap-2">
          <label htmlFor="ask" className="text-sm font-medium">
            Ask a question
          </label>
          {/* NO PURCHASE REQUIRED, which is the whole difference from a review.
              A question is what you ask BEFORE buying, so gating it on an order
              would leave it askable only by people who no longer need to ask. */}
          <Textarea
            id="ask"
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              setError(null);
            }}
            rows={3}
            maxLength={1000}
            placeholder="Does it come with a charger?"
          />
          {error !== null && (
            <p role="alert" className="text-xs text-warn">
              {error}
            </p>
          )}
          <Button
            type="button"
            onClick={ask}
            disabled={pending || body.trim().length < 5}
            className="self-start"
          >
            {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />}
            Post question
          </Button>
        </div>
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">
          Sign in to ask a question or answer one.
        </p>
      )}
    </section>
  );
}

function QuestionCard({
  question,
  signedIn,
  onAnswered,
}: {
  question: Question;
  signedIn: boolean;
  onAnswered: (question: Question) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <article className="flex flex-col gap-2">
      <p className="text-sm font-medium">{question.body}</p>
      <p className="text-xs text-muted-foreground">
        {question.authorName} · {formatDate(question.createdAt)}
      </p>

      {question.answers.length > 0 && (
        <ul className="mt-1 flex flex-col gap-3 border-l-2 border-border pl-4">
          {question.answers.map((answer) => (
            <li key={answer.id} className="flex flex-col gap-0.5">
              <p className="text-sm">{answer.body}</p>
              <p className="text-xs text-muted-foreground">
                {answer.sellerName === null ? (
                  answer.authorName
                ) : (
                  <>
                    {/* WHICH seller, not merely that a seller replied. Several
                        sellers list one product here, and a buyer weighing two
                        offers wants to know whether the answer came from the
                        one they are considering. */}
                    <span className="font-medium text-foreground">{answer.sellerName}</span>{' '}
                    <span className="text-verified">· seller</span>
                  </>
                )}{' '}
                · {formatDate(answer.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {signedIn &&
        (open ? (
          <div className="mt-1 flex max-w-xl flex-col gap-2">
            <label htmlFor={`answer-${question.id}`} className="sr-only">
              Your answer
            </label>
            <Textarea
              id={`answer-${question.id}`}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
                setError(null);
              }}
              rows={2}
              maxLength={2000}
            />
            {error !== null && (
              <p role="alert" className="text-xs text-warn">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                type="button"
                disabled={pending || body.trim() === ''}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await answerQuestion(question.id, body);
                    if (!result.ok) {
                      setError(result.message);
                      return;
                    }
                    onAnswered(result.question);
                    setBody('');
                    setOpen(false);
                  });
                }}
              >
                {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />}
                Post answer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
            className="self-start rounded-sm text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Answer this
          </button>
        ))}
    </article>
  );
}
