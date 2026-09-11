import type { ReactNode } from 'react';
import type { RatingSummary, Review } from '@nexmarket/api-client';
import { RatingStars } from '@/components/rating-stars';
import { ReviewActions } from '@/components/review-actions';
import { formatDate } from '@/lib/format';
import { reviewPhotoUrl } from '@/lib/media';
import { isUnderReview, reviewCountLabel, reviewHeading, scaledBars } from '@/lib/reviews';

/**
 * What buyers said, under the offers. PRD 9.5.
 *
 * BELOW the buy box, never above it. The question this page exists to answer is
 * "which of these sellers should I buy from", and the comparison table answers
 * it; the reviews are the evidence someone consults after the shortlist, not
 * before it. Putting a rating block first would push the thing the page is for
 * below the fold to make room for context on a decision nobody has started.
 *
 * A server component. Nothing here reacts to anything - the form that writes a
 * review lives on the buyer's own orders, where the proof of purchase is.
 */
export function ReviewPanel({
  summary,
  reviews,
  productSlug,
}: {
  summary: RatingSummary;
  reviews: readonly Review[];
  /** For the report action, which revalidates the page it was pressed on. */
  productSlug: string;
}): ReactNode {
  return (
    <section className="mt-12 border-t pt-8" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading" className="text-lg font-semibold">
        What buyers said
      </h2>

      {summary.total === 0 ? (
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          {/* Not an empty state with a call to action nobody can answer: only a
              delivered purchase can be reviewed, so an anonymous reader has
              nothing to do here and should not be asked. */}
          No reviews yet. Ratings appear once buyers have received their orders.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-10">
            <Headline summary={summary} />
            <Histogram summary={summary} />
          </div>

          <ul className="mt-8 flex flex-col gap-6">
            {reviews.map((review) => (
              <li key={review.id}>
                <ReviewCard review={review} productSlug={productSlug} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Headline({ summary }: { summary: RatingSummary }): ReactNode {
  return (
    <div className="shrink-0">
      <p className="text-4xl font-semibold tabular">
        {summary.average === null ? '—' : summary.average.toFixed(1)}
      </p>
      <div className="mt-1">
        <RatingStars average={summary.average} size="lg" showLabel={false} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{reviewCountLabel(summary.total)}</p>
    </div>
  );
}

/**
 * The distribution, scaled so the tallest bar fills the track.
 *
 * The percentage printed beside each bar is the TRUE share; the drawn width is
 * scaled to the mode. On a product where four reviews in five are five-star,
 * drawing 80% and 20% wastes the fifth of the chart nothing reaches - and the
 * shape of a distribution is the entire reason to draw one rather than print an
 * average. Nothing is hidden: the real number is right there.
 */
function Histogram({ summary }: { summary: RatingSummary }): ReactNode {
  return (
    <div className="min-w-0 flex-1">
      {scaledBars(summary).map((bar) => (
        <div key={bar.stars} className="flex items-center gap-3 py-0.5 text-xs">
          <span className="w-10 shrink-0 tabular text-muted-foreground">{bar.stars} star</span>
          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-sunk">
            <span
              className="block h-full rounded-full bg-foreground/70"
              style={{ width: `${String(bar.width)}%` }}
            />
          </span>
          <span className="w-9 shrink-0 text-right tabular text-muted-foreground">
            {bar.share}%
          </span>
        </div>
      ))}
    </div>
  );
}

function ReviewCard({
  review,
  productSlug,
}: {
  review: Review;
  productSlug: string;
}): ReactNode {
  return (
    <article className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* "Rated 4 out of 5", not "4.0 out of 5". A screen reader meets this
            string twice on the page - once as the product's average and once
            per review - and two identical sentences a few seconds apart are
            impossible to tell apart by ear. One is an aggregate, the other is
            one person's verdict, and the wording should say which. */}
        <RatingStars
          average={review.rating}
          label={`Rated ${String(review.rating)} out of 5`}
          showLabel={false}
        />
        <h3 className="text-sm font-medium">{reviewHeading(review)}</h3>
      </div>

      <p className="text-xs text-muted-foreground">
        {/* VERIFIED PURCHASE IS NOT A BADGE HERE, because it cannot be anything
            else: a review hangs off an order line, so every review on this page
            is one. A badge that never varies is furniture. What varies, and is
            worth saying, is WHO SOLD IT - on a marketplace the same product
            comes from several sellers and the experience differs by seller. */}
        {review.authorName} · bought from {review.sellerName} · {formatDate(review.createdAt)}
      </p>

      {review.body.trim() !== '' && (
        <p className="max-w-prose whitespace-pre-line text-sm">{review.body}</p>
      )}

      {review.photoIds.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-2">
          {review.photoIds.map((id) => (
            <li key={id}>
              {/* A plain <img>, not next/image: the API
                  streams these from an opaque storage key, so there is no
                  remote pattern for next/image to whitelist and no intrinsic
                  size known ahead of time. */}
              <img
                src={reviewPhotoUrl(id)}
                alt={`Photo from ${review.authorName}'s review`}
                loading="lazy"
                className="size-20 rounded-md border border-border object-cover"
              />
            </li>
          ))}
        </ul>
      )}

      <ReviewActions
        reviewId={review.id}
        helpfulCount={review.helpfulCount}
        productSlug={productSlug}
      />

      {isUnderReview(review) && (
        <p className="text-xs text-warn">
          {/* Said out loud rather than silently hidden. A report is an
              accusation, not a verdict - the review stays up until a human
              agrees - and a reader deserves to know a dispute is open rather
              than finding the page quietly different tomorrow. */}
          Reported. A moderator is looking at this.
        </p>
      )}
    </article>
  );
}
