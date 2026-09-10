import type { ReactNode } from 'react';
import type { OrderEvent } from '@nexmarket/api-client';
import { toSteps, type Tone } from '@/lib/order-timeline';
import { cn } from '@/lib/utils';

/**
 * What happened to this order, in the order it happened.
 *
 * A vertical rail with markers, which is structure rather than decoration:
 * this content genuinely IS a sequence, and the rail is what lets the eye read
 * down it. Nothing here animates - the design direction spends the entire
 * motion budget on the buy box total, and a timeline that slides in on load is
 * the tell of a page designed by nobody in particular.
 *
 * Colour is information. The whole normal path is uncoloured; only a delivery
 * and a cancellation carry a tone, which is what makes them readable at a
 * glance in a list of six identical grey rows.
 */
export function OrderTimeline({
  events,
  sellerName,
}: {
  events: readonly OrderEvent[];
  sellerName: string;
}): ReactNode {
  const steps = toSteps(events, sellerName);
  if (steps.length === 0) return null;

  return (
    <ol className="relative flex flex-col gap-5 pl-6">
      {/* One hairline behind every marker, stopping at the last one so the rail
          does not trail off past the end of the story. */}
      <span
        aria-hidden="true"
        className="absolute bottom-3 left-[3.5px] top-2 w-px bg-border"
      />
      {steps.map((step) => (
        <li key={step.id} className="relative">
          <span
            aria-hidden="true"
            className={cn(
              'absolute -left-6 top-[5px] h-2 w-2 rounded-full ring-4 ring-background',
              markerFor(step.tone),
            )}
          />
          <p className={cn('text-sm', step.tone === 'warn' ? 'text-warn' : 'text-foreground')}>
            {step.label}
          </p>
          {step.detail !== null && (
            <p className="mt-0.5 text-sm text-muted-foreground">{step.detail}</p>
          )}
          <time
            dateTime={step.at}
            className="mt-0.5 block text-xs tabular text-muted-foreground"
          >
            {formatStepTime(step.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

function markerFor(tone: Tone): string {
  if (tone === 'signal') return 'bg-primary';
  if (tone === 'warn') return 'bg-warn';
  return 'bg-muted-foreground/50';
}

/**
 * Date and time, because "when did it ship" is a question about a day AND an
 * hour once a parcel is moving. `en-BD` for the same reason `formatMoney` uses
 * it: this reads as built here or it does not.
 */
function formatStepTime(iso: string): string {
  return new Date(iso).toLocaleString('en-BD', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
