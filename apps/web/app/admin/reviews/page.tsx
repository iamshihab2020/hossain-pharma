import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { endpoints, type Review } from '@nexmarket/api-client';
import { apiGet, isSignedIn } from '@/lib/api/server';
import { ModerationActions } from '@/components/moderation-actions';
import { RatingStars } from '@/components/rating-stars';
import { formatDate } from '@/lib/format';
import { reviewPhotoUrl } from '@/lib/media';

export const metadata: Metadata = { title: 'Moderation queue' };

/**
 * PRD 9.6's content moderation queue, for reviews.
 *
 * EVERYTHING HERE IS STILL LIVE. A flagged review is on the product page, is
 * counted in the rating, and stays that way until somebody on this screen
 * decides otherwise - a report is an accusation, not a verdict. That makes this
 * a queue of things to JUDGE rather than a queue of things to release, which is
 * the opposite of how a pre-moderation console reads and worth saying out loud
 * on the page.
 *
 * The reasons are shown per item, because "flagged" alone teaches the next
 * moderator nothing and trains them to skim. One signal is usually a mistake;
 * three together rarely are.
 */
export default async function ModerationPage(): Promise<ReactNode> {
  if (!(await isSignedIn())) redirect('/signin?next=/admin/reviews');

  const { items } = await apiGet(endpoints.moderationQueue(), { auth: true });

  return (
    <div className="mx-auto w-full max-w-4xl py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Moderation queue</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Everything below is <strong className="font-medium text-foreground">still visible</strong>{' '}
        on the site and still counted in its product&rsquo;s rating. A report puts something here;
        only removing it takes it down.
      </p>

      {items.length === 0 ? (
        <p className="mt-10 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Nothing waiting. Reports and auto-flags appear here.
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-8">
          {items.map((review) => (
            <li key={review.id} className="border-t pt-6 first:border-t-0 first:pt-0">
              <Flagged review={review} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Flagged({ review }: { review: Review }): ReactNode {
  return (
    <article className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RatingStars
          average={review.rating}
          label={`Rated ${String(review.rating)} out of 5`}
          showLabel={false}
        />
        {review.title.trim() !== '' && <h2 className="text-sm font-medium">{review.title}</h2>}
        <span className="flex flex-wrap gap-1">
          {review.flagReasons.map((reason) => (
            <span
              key={reason}
              className="rounded-sm bg-warn-wash px-1.5 py-0.5 text-xs font-medium text-warn"
            >
              {reason}
            </span>
          ))}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {review.authorName} · bought from {review.sellerName} · {formatDate(review.createdAt)} ·{' '}
        {/* The SLUG, which the view carries for exactly this: `productId`
            routes nowhere, and a moderator judging a review needs to see the
            page it is on. */}
        <Link href={`/p/${review.productSlug}`} className="underline-offset-2 hover:underline">
          see it in context
        </Link>
      </p>

      {review.body.trim() !== '' && (
        <p className="max-w-prose whitespace-pre-line rounded-md bg-sunk p-3 text-sm">
          {review.body}
        </p>
      )}

      {review.photoIds.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {review.photoIds.map((id) => (
            <li key={id}>
              {/* A plain <img>, not next/image: the API
                  streams these from an opaque storage key, so there is no
                  remote pattern for next/image to whitelist and no width known
                  ahead of time. */}
              <img
                src={reviewPhotoUrl(id)}
                alt=""
                className="size-24 rounded-md border border-border object-cover"
              />
            </li>
          ))}
        </ul>
      )}

      <ModerationActions reviewId={review.id} />
    </article>
  );
}
