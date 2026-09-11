'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { collectCod } from '@/app/actions/cod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Recording cash taken at the door.
 *
 * PREFILLED WITH THE FULL AMOUNT, because that is what usually happened, and
 * EDITABLE, because it is not always. A courier can come back short; the gap
 * stays in COD_RECEIVABLE rather than being written off, and this field is the
 * only place a person can say so.
 *
 * Minor units in, major units on screen. The input takes taka and the action
 * converts, because nobody types paisa.
 */
export function CollectCodForm({
  tenantId,
  orderId,
  expectedMinor,
  currency,
}: {
  tenantId: string;
  orderId: string;
  expectedMinor: number;
  currency: string;
}): ReactNode {
  const [amount, setAmount] = useState((expectedMinor / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    startTransition(async () => {
      const result = await collectCod(tenantId, orderId, amount, currency);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor={`cod-${orderId}`} className="sr-only">
          Amount collected for this order
        </label>
        <Input
          id={`cod-${orderId}`}
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setError(null);
          }}
          inputMode="decimal"
          className="h-8 w-28 text-right tabular"
          aria-describedby={error === null ? undefined : `cod-${orderId}-error`}
          aria-invalid={error !== null}
        />
        <Button size="sm" variant="outline" className="h-8" onClick={submit} disabled={pending}>
          {pending && <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />}
          Record
        </Button>
      </div>
      {error !== null && (
        <p id={`cod-${orderId}-error`} className="text-xs text-warn">
          {error}
        </p>
      )}
    </div>
  );
}
