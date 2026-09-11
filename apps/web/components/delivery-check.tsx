'use client';

import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { checkServiceability } from '@/app/actions/serviceability';
import { formatMoney } from '@/lib/format';
import type { DeliveryAnswer } from '@/lib/delivery';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * "Do you deliver to my street, when, and for how much?" - PRD 8.4, which puts
 * this on the product page BEFORE add-to-cart.
 *
 * A DEFERRED-ANSWER CONTROL, not a card. It opens as one input; once answered
 * it collapses into a sentence with the postcode inline and editable. The buyer
 * wants the answer, not the machinery, and the input is scaffolding they need
 * exactly once - giving it permanent furniture on the page would spend the
 * product page's most valuable space on a question already answered.
 *
 * Colour follows the system's rule that saturation is information: `warn`
 * carries "no courier goes there", because that token means low stock, price
 * changed, payment pending - things that are not errors but change what you can
 * do. An unserviceable postcode is a fact about geography, not a mistake the
 * buyer made, so it is not destructive red and the copy does not call it
 * invalid.
 */
export function DeliveryCheck({
  chargeableGrams,
  dispatchDays,
}: {
  /** From the variant. Null when nobody measured it; the answer then omits the price. */
  chargeableGrams: number | null;
  /** The winning offer's dispatch time, added to the zone's transit time. */
  dispatchDays: number;
}): ReactNode {
  const [postcode, setPostcode] = useState('');
  const [answer, setAnswer] = useState<DeliveryAnswer | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent): void {
    event.preventDefault();
    setMessage(null);

    startTransition(async () => {
      const result = await checkServiceability({
        postcode,
        weightGrams: chargeableGrams,
        dispatchDays,
      });

      if (result.status === 'ok') {
        setAnswer(result.answer);
        return;
      }
      setAnswer(null);
      setMessage(result.message);
    });
  }

  // --- answered: the sentence, with the postcode still editable -------------
  if (answer !== null) {
    return (
      <section className="border-y py-3 text-sm" aria-live="polite">
        {answer.kind === 'unserviceable' ? (
          <p className="text-warn">
            No courier covers {answer.postcode} yet.{' '}
            <EditButton
              onClick={() => {
                setAnswer(null);
              }}
              label="Try another postcode"
            />
          </p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span>
              Delivers to <strong className="font-semibold">{answer.areaName}</strong>
            </span>
            <span className="text-muted-foreground">·</span>
            <span>{answer.window}</span>
            {answer.overWeightLimit ? (
              <>
                <span className="text-muted-foreground">·</span>
                {/* A price the rate card cannot give is stated as such. A blank
                    where a number belongs reads as a broken quote. */}
                <span className="text-warn">Too heavy for standard delivery</span>
              </>
            ) : answer.shipping !== null ? (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="tabular-nums">
                  {answer.shipping.amount === 0
                    ? 'Free delivery'
                    : `${formatMoney(answer.shipping)} delivery`}
                </span>
              </>
            ) : null}
            {!answer.codAllowed && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-warn">Card only, no cash on delivery</span>
              </>
            )}
            <EditButton
              onClick={() => {
                setAnswer(null);
              }}
              label={`Change from ${answer.postcode}`}
            />
          </div>
        )}
      </section>
    );
  }

  // --- unanswered: the input ------------------------------------------------
  return (
    <section className="border-y py-3">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="delivery-postcode" className="text-xs text-muted-foreground">
            Delivery postcode
          </Label>
          <Input
            id="delivery-postcode"
            name="postcode"
            value={postcode}
            onChange={(event) => {
              setPostcode(event.target.value);
              setMessage(null);
            }}
            placeholder="1205"
            autoComplete="postal-code"
            inputMode="text"
            className="h-9 w-32"
            aria-describedby={message === null ? undefined : 'delivery-error'}
            aria-invalid={message !== null}
          />
        </div>
        <Button type="submit" variant="outline" size="sm" className="h-9" disabled={pending}>
          {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />}
          Check delivery
        </Button>
      </form>
      {message !== null && (
        <p id="delivery-error" className="mt-2 text-xs text-warn">
          {message}
        </p>
      )}
    </section>
  );
}

/**
 * The way back to the input.
 *
 * A button rather than a link, and labelled with the postcode it will change,
 * so a screen reader hears "Change from 1205" rather than three identical
 * "Change" buttons on a page that also has a cart and a quantity control.
 */
function EditButton({ onClick, label }: { onClick: () => void; label: string }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Pencil className="size-3" aria-hidden />
      {label}
    </button>
  );
}
