'use client';

import { useState, useTransition, type ChangeEvent, type ReactNode } from 'react';
import { ImagePlus, Loader2, Star, X } from 'lucide-react';
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
  const [photos, setPhotos] = useState<{ name: string; contentType: string; base64: string }[]>(
    [],
  );
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
          /**
           * PHOTOS AFTER THE REVIEW, never before.
           *
           * A photo needs a review id to hang off, so there is nothing to
           * attach one to until the review exists. That ordering also decides
           * what a half-failure looks like: a review with fewer photos than
           * intended, which the buyer can see and live with, rather than
           * orphaned bytes belonging to nothing.
           *
           * `writeReview` REDIRECTS on success, so it cannot return the id -
           * which is why the photos go up first against a review created here
           * only when there are photos to attach. With none, the common case,
           * this is one call exactly as before.
           */
          const result = await writeReview(orderItemId, form, photos);
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

      <div className="flex flex-col gap-2">
        <label
          htmlFor={`photos-${orderItemId}`}
          className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-wash focus-within:ring-2 focus-within:ring-ring"
        >
          <ImagePlus className="size-3.5" aria-hidden />
          Add photos (optional)
          <input
            id={`photos-${orderItemId}`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              void addFiles(event, photos, setPhotos, setError);
            }}
          />
        </label>

        {photos.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {photos.map((photo) => (
              <li key={photo.name} className="relative">
                {/* A plain <img>, not next/image: a data
                    URL from the buyer's own disk; there is no remote pattern
                    for next/image to whitelist and nothing to optimise. */}
                <img
                  src={`data:${photo.contentType};base64,${photo.base64}`}
                  alt={photo.name}
                  className="size-16 rounded-md border border-border object-cover"
                />
                <button
                  type="button"
                  aria-label={`Remove ${photo.name}`}
                  onClick={() => {
                    setPhotos(photos.filter((other) => other.name !== photo.name));
                  }}
                  className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-card p-0.5 hover:bg-wash"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
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

/** How many photos one review may carry. Matches the API, which refuses a
 *  fifth - enough to show a fault from two angles, not an album. */
const MAX_PHOTOS = 4;

/** Two megabytes of original file, which is roughly a phone photo. Checked
 *  here as well as at the API so the buyer hears about it before the upload
 *  rather than after it. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Reads the chosen files into base64, in the BROWSER.
 *
 * Not in the Server Action: a `File` crossing that boundary would be buffered
 * twice, and the API takes base64 anyway - the same shape product media has
 * used since Phase 2, which avoids registering a multipart parser for one
 * route.
 */
async function addFiles(
  event: ChangeEvent<HTMLInputElement>,
  current: { name: string; contentType: string; base64: string }[],
  setPhotos: (photos: { name: string; contentType: string; base64: string }[]) => void,
  setError: (message: string | null) => void,
): Promise<void> {
  const chosen = [...(event.target.files ?? [])];
  // Clear the input so choosing the same file twice still fires a change.
  event.target.value = '';

  const next = [...current];
  for (const file of chosen) {
    if (next.length >= MAX_PHOTOS) {
      setError(`Up to ${String(MAX_PHOTOS)} photos.`);
      break;
    }
    if (file.size > MAX_BYTES) {
      setError(`${file.name} is over 2 MB.`);
      continue;
    }
    next.push({
      name: file.name,
      contentType: file.type,
      base64: await toBase64(file),
    });
  }

  setPhotos(next);
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error(`Could not read ${file.name}`));
    };
    reader.onload = () => {
      // `readAsDataURL` gives "data:image/png;base64,AAAA"; the API wants the
      // payload alone, and splitting on the first comma is exact rather than
      // a guess about the prefix's length.
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}
