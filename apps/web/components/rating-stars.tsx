import type { ReactNode } from 'react';
import { Star, StarHalf } from 'lucide-react';
import { ratingLabel } from '@/lib/reviews';
import { cn } from '@/lib/utils';

/**
 * A rating, as five stars and a number.
 *
 * MONOCHROME, and that is a decision rather than an omission. DESIGN-DIRECTION
 * §4 says saturation is information in this system: `warn` means low stock or a
 * price that moved, `success` means it went through, `verified` means we stand
 * behind the seller. A row of gold stars would be the one splash of colour on
 * the page that means nothing at all, and it would pull the eye away from the
 * two that do.
 *
 * The NUMBER is not decoration either. Five glyphs cannot distinguish 4.3 from
 * 4.7, and the difference between those two is most of what a buyer comparing
 * sellers wants. The stars are the glance; the figure beside them is the answer.
 */
export function RatingStars({
  average,
  size = 'sm',
  showLabel = true,
  label,
}: {
  average: number | null;
  size?: 'sm' | 'lg';
  showLabel?: boolean;
  /** Overrides the default "4.3 out of 5" - used where the count follows. */
  label?: string;
}): ReactNode {
  const glyph = size === 'lg' ? 'size-5' : 'size-3.5';
  const halves = average === null ? 0 : Math.round(average * 2);

  return (
    <span className="inline-flex items-center gap-1.5">
      {/* aria-hidden on the glyphs and the real answer in text: five icons read
          out one by one is noise, and the sentence beside them is the content. */}
      <span className="inline-flex items-center gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((position) => {
          const full = halves >= position * 2;
          const half = halves === position * 2 - 1;
          if (half) {
            return <StarHalf key={position} className={cn(glyph, 'fill-foreground text-foreground')} />;
          }
          return (
            <Star
              key={position}
              className={cn(
                glyph,
                full ? 'fill-foreground text-foreground' : 'fill-none text-line-strong',
              )}
            />
          );
        })}
      </span>
      <span className={cn('tabular', size === 'lg' ? 'text-sm' : 'text-xs', !showLabel && 'sr-only')}>
        {label ?? ratingLabel({ average, total: 0, distribution: [] })}
      </span>
    </span>
  );
}
