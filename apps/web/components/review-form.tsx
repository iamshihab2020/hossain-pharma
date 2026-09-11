'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Loader2, Star } from 'lucide-react';
import { writeReview } from '@/app/actions/reviews';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * Writing a review, on the buyer's own delivered order.
 *
 * HERE RATHER THAN ON THE PRODUCT PAGE, and that is the whole shape of Phase 7.
 * A review hangs off an order line, so the only place a person can write one is
 * somewhere that knows which line - and a "write a review" button on a product
 * page would have to guess, or offer itself to people who never bought it. The
 * server would refuse them, which is a button that exists to produce an error.
 *
 * STARS FIRST AND EVERYTHING ELSE OPTIONAL. The rating is the part that has to
 * be there: it is what the aggregate needs and what a stranger reads first. A
 * required title produces worse titles, not better ones - somebody who wants to
 * say "arrived bent" should be able to say only that.
 */
export function ReviewForm({
  orderItemId,
  productName,
  sellerName,
}: {
  orderItemId: string;
  productName: string;
  sellerName: string;
}): ReactNode {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // NO `done` STATE. A successful post redirects, because a Server Action
  // refreshes the route it was called from and this form is inside the list
  // that refresh rebuilds - any success flag set here paints into a component
  // that has already unmounted. See `writeReview`.
  const shown = hovered === 0 ? rating : hovered;

  return (
    <form
      action={(form: FormData) => {
        setError(null);
        startTransition(async () => {
          // Only the FAILURE path returns; success redirects out of here.
          const result = await writeReview(orderItemId, form);
          if (!result.ok) setError(result.message);
        });
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="rating" value={rating} />

      {/**
       * RADIOS UNDER THE STARS, not five buttons.
       *
       * This is one choice among five, which is what a radio group means to a
       * screen reader - and it is what makes the control work with a keyboard
       * without anybody writing arrow-key handling. The stars are the visible
       * label; `sr-only` inputs behind them carry the semantics, the same
       * pattern the offer table and the slot picker use.
       */}
      <fieldset
        className="flex flex-col gap-1"
        onMouseLeave={() => {
          setHovered(0);
        }}
      >
        <legend className="text-sm font-medium">
          How was {productName}, from {sellerName}?
        </legend>
        <div className="mt-1 flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <label
              key={value}
              htmlFor={`star-${String(value)}`}
              className="cursor-pointer rounded-sm p-0.5 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
              onMouseEnter={() => {
                setHovered(value);
              }}
            >
              <input
                type="radio"
                id={`star-${String(value)}`}
                name="star"
                className="sr-only"
                checked={rating === value}
                onChange={() => {
                  setRating(value);
                  setError(null);
                }}
              />
              <Star
                className={cn(
                  'size-6',
                  value <= shown ? 'fill-foreground text-foreground' : 'fill-none text-line-strong',
                )}
                aria-hidden
              />
              <span className="sr-only">
                {value} star{value === 1 ? '' : 's'}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`title-${orderItemId}`} className="text-xs text-muted-foreground">
          Headline (optional)
        </Label>
        <Input id={`title-${orderItemId}`} name="title" maxLength={160} className="max-w-md" />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`body-${orderItemId}`} className="text-xs text-muted-foreground">
          What should other buyers know? (optional)
        </Label>
        <Textarea id={`body-${orderItemId}`} name="body" maxLength={4000} rows={4} className="max-w-md" />
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
      )}

      <Button type="submit" className="self-start" disabled={pending || rating === 0}>
        {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />}
        Post review
      </Button>
    </form>
  );
}
