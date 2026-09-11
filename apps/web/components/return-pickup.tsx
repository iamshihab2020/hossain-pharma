'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { DeliverySlot, ReturnPickup } from '@nexmarket/api-client';
import { scheduleReturnPickup } from '@/app/actions/returns';
import { SlotPicker } from '@/components/slot-picker';
import { formatDate, formatMinute } from '@/lib/slots';
import { Button } from '@/components/ui/button';

/**
 * Booking a collection for something that arrived and should not have.
 *
 * DELIBERATELY MODEST COPY. This books a van and nothing else - the return
 * itself, its reason, the inspection and any refund are Phase 8's RMA workflow.
 * Promising "return this item" here would commit the product to an outcome
 * nothing behind this button can deliver, and a buyer who reads it that way and
 * then loses a dispute has been misled by the interface rather than by the
 * decision.
 */
export function ReturnPickupPanel({
  orderId,
  slots,
  existing,
  today,
}: {
  orderId: string;
  slots: readonly DeliverySlot[];
  existing: ReturnPickup | null;
  today: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (existing !== null) {
    return (
      <p className="text-sm">
        A courier is booked to collect this on{' '}
        <strong className="font-semibold">{formatDate(existing.slot.date)}</strong>, between{' '}
        {formatMinute(existing.slot.startMinute)} and {formatMinute(existing.slot.endMinute)}.
      </p>
    );
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => { setOpen(true); }}>
        Book a collection
      </Button>
    );
  }

  function book(): void {
    if (slotId === null) {
      setError('Choose a collection window first.');
      return;
    }
    setError(null);

    startTransition(async () => {
      const result = await scheduleReturnPickup(orderId, slotId);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Pick a window and a courier will come to the delivery address. Booking a collection
        does not decide the return - the seller inspects it once it is back.
      </p>

      <SlotPicker slots={slots} value={slotId} onChange={setSlotId} today={today} />

      {error !== null && <p className="text-xs text-warn">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" onClick={book} disabled={pending}>
          {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />}
          Book collection
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { setOpen(false); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
