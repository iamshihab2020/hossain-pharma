'use client';

import { useOptimistic, useState, useTransition, type ReactNode } from 'react';
import { Loader2, Minus, Plus, Trash2 } from 'lucide-react';
import type { CartLine } from '@nexmarket/api-client';
import { removeItem, setQuantity } from '@/app/actions/cart';
import { formatMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * One cart line, with an optimistic quantity.
 *
 * `useOptimistic` rather than a client data library: React 19 does this
 * natively, and the round trip that follows is a Server Action, which is the
 * same job `useMutation` plus cache invalidation would do. A library here would
 * add a second cache next to Next's without removing either round trip.
 *
 * The known limit, stated rather than hidden: Server Actions serialise, so
 * hammering the stepper queues rather than coalescing. The optimistic value
 * keeps the UI honest meanwhile. If that becomes a real complaint, debouncing
 * the action is the fix - not a data library.
 */
export function CartLineRow({ line }: { line: CartLine }): ReactNode {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [quantity, setOptimisticQuantity] = useOptimistic(line.quantity);

  function change(next: number): void {
    if (next < 1) return;
    setError(null);
    startTransition(async () => {
      setOptimisticQuantity(next);
      const result = await setQuantity(line.id, next);
      if (!result.ok) setError(result.message);
    });
  }

  function drop(): void {
    setError(null);
    startTransition(async () => {
      const result = await removeItem(line.id);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="flex flex-wrap items-start gap-4 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug">{line.productName}</p>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">{line.variantSku}</p>

        {!line.available && (
          <Badge
            variant="outline"
            className="mt-2 border-warn/40 bg-warn-wash font-normal text-warn"
          >
            {line.unavailableReason ?? 'No longer available'}
          </Badge>
        )}

        {error !== null && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Quantity">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => { change(quantity - 1); }}
          disabled={pending || quantity <= 1}
          aria-label="Decrease quantity"
        >
          <Minus className="h-3 w-3" />
        </Button>
        <span className="w-8 text-center text-sm tabular" aria-live="polite">
          {pending ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : quantity}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => { change(quantity + 1); }}
          disabled={pending}
          aria-label="Increase quantity"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <div className="w-24 text-right">
        <p className="font-semibold tabular">{formatMoney(line.lineTotal)}</p>
        <p className="text-xs text-muted-foreground tabular">
          {formatMoney(line.unitPrice)} each
        </p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground"
        onClick={drop}
        disabled={pending}
        aria-label={`Remove ${line.productName}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
