'use client';

import { useMemo, type ReactNode } from 'react';
import type { DeliverySlot } from '@nexmarket/api-client';
import { groupByDay } from '@/lib/slots';
import { cn } from '@/lib/utils';

/**
 * Choosing a delivery window.
 *
 * A TIMETABLE, not a card deck. Dates across, windows down, and the whole thing
 * scannable in one pass - which is how a person reads any schedule, and why the
 * console's tabular density is the right register here even on the buyer side.
 * Cards would give each window a box worth of furniture to say two facts.
 *
 * ONE PICKER FOR THE WHOLE CART, not one per seller. PRD 9.1 says "delivery
 * slot per seller group", and Phase 6 deliberately did not build it that way: a
 * slot is a COURIER's capacity in a ZONE, so three sellers share one window and
 * the buyer answers the question once. Three pickers would be three chances to
 * choose three different mornings for parcels arriving at one door.
 *
 * Radios rather than buttons, because this is a single choice among many and
 * that is what a radio group means to a screen reader. `sr-only` inputs with a
 * styled label is the same pattern the offer table uses.
 */
export function SlotPicker({
  slots,
  value,
  onChange,
  today,
}: {
  slots: readonly DeliverySlot[];
  value: string | null;
  onChange: (slotId: string | null) => void;
  /** Resolved on the server and passed in, so "Today" cannot drift at midnight. */
  today: string;
}): ReactNode {
  const days = useMemo(
    () => groupByDay(slots, new Date(`${today}T00:00:00Z`)),
    [slots, today],
  );

  if (days.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No scheduled windows on this route. We will deliver as soon as it arrives.
      </p>
    );
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Delivery window</legend>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {days.map((day) => (
          <div key={day.date} className="flex min-w-[8.5rem] flex-col gap-1.5">
            <p className="text-xs font-medium">
              {day.relative ?? day.label}
              {day.relative !== null && (
                <span className="ml-1 font-normal text-muted-foreground">{day.label}</span>
              )}
            </p>

            {day.windows.map((window) => {
              const id = `slot-${window.id}`;
              const selected = value === window.id;
              return (
                <label
                  key={window.id}
                  htmlFor={id}
                  className={cn(
                    'cursor-pointer rounded-md border px-2 py-1.5 text-xs',
                    selected ? 'border-primary bg-wash font-medium' : 'border-border',
                  )}
                >
                  <input
                    type="radio"
                    id={id}
                    name="delivery-slot"
                    className="sr-only"
                    checked={selected}
                    onChange={() => {
                      onChange(window.id);
                    }}
                  />
                  <span className="block whitespace-nowrap">{window.label}</span>
                  {/* Scarcity only when it is true. "40 left" on every window
                      is noise; "3 left" is a reason to decide now. */}
                  {window.scarce && (
                    <span className="block text-warn">{window.remaining} left</span>
                  )}
                </label>
              );
            })}
          </div>
        ))}
      </div>

      {value !== null && (
        <button
          type="button"
          onClick={() => {
            onChange(null);
          }}
          className="self-start rounded-sm text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Clear the window and deliver whenever it arrives
        </button>
      )}
    </fieldset>
  );
}
