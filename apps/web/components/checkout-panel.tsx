'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { Banknote, CreditCard, Loader2 } from 'lucide-react';
import type { DeliverySlot, Quote } from '@nexmarket/api-client';
import { confirmCheckout } from '@/app/actions/checkout';
import { formatMoney } from '@/lib/format';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { SlotPicker } from '@/components/slot-picker';

/**
 * The payment panel.
 *
 * **Cash on delivery is first, and it is not a fallback.** It is how most of
 * this market pays, and it is the case that justifies a double-entry ledger
 * existing at all: the order is placed, the intent goes to COD_PENDING, and
 * checkout accrues to COD_RECEIVABLE - the account measuring the gap between
 * "delivered" and "collected".
 *
 * The idempotency key is minted ONCE per mounted panel, not per click. That is
 * the whole point: a double-submitted confirm returns the original orders
 * rather than placing a second set. A key regenerated on each attempt would
 * make the guard useless exactly when it is needed.
 */
export function CheckoutPanel({
  addressId,
  quote,
  slots,
  today,
}: {
  addressId: string;
  quote: Quote;
  /** Windows for the address's zone. Empty on an unserviceable or foreign route. */
  slots: readonly DeliverySlot[];
  today: string;
}): ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /**
   * COD is the default only where it is POSSIBLE.
   *
   * `zone.codAllowed` is false where a courier will deliver but will not carry
   * cash back, and defaulting to a method the buyer cannot use means the first
   * thing the panel does is refuse them. The API enforces the same rule on
   * confirm - hiding the radio is a courtesy, not the control.
   */
  const codAllowed = quote.zone?.codAllowed ?? true;
  const [method, setMethod] = useState<'cod' | 'mock'>(codAllowed ? 'cod' : 'mock');
  const [slotId, setSlotId] = useState<string | null>(null);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [priceChange, setPriceChange] = useState<string | null>(null);

  // Keyed on the cart and the total so a genuinely different order gets a
  // different key, while a retry of the same one does not.
  const idempotencyKey = useMemo(
    () => `${quote.cartId}:${String(quote.total.amount)}:${crypto.randomUUID()}`,
    [quote.cartId, quote.total.amount],
  );

  function place(): void {
    setError(null);
    setPriceChange(null);

    startTransition(async () => {
      const result = await confirmCheckout({
        addressId,
        paymentMethod: method,
        idempotencyKey,
        expectedTotal: quote.total,
        ...(slotId === null ? {} : { deliverySlotId: slotId }),
        ...(quote.requiresAgeCheck && dateOfBirth !== '' ? { dateOfBirth } : {}),
      });

      if (result.status === 'placed') {
        const first = result.confirmation.orders[0];
        router.push(first === undefined ? '/orders' : `/orders?placed=${first.orderNumber}`);
        return;
      }

      if (result.status === 'price-changed') {
        // The buyer's correct next move is to LOOK at the new number, not to
        // retry, so the page reloads the quote and says what moved.
        setPriceChange(
          result.actual === null
            ? result.message
            : `The price changed while you were checking out. The new total is ${formatMoney(result.actual)}.`,
        );
        router.refresh();
        return;
      }

      if (result.status === 'age-required') {
        setError('Enter your date of birth to buy age-restricted items.');
        return;
      }

      setError(result.message);
    });
  }

  const ageMissing = quote.requiresAgeCheck && dateOfBirth === '';

  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-base">Payment</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {priceChange !== null && (
          <Alert className="border-warn/40 bg-warn-wash">
            <AlertTitle className="text-warn">Prices moved</AlertTitle>
            <AlertDescription className="text-warn">
              {priceChange} Review it before you pay.
            </AlertDescription>
          </Alert>
        )}

        {error !== null && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* ABOVE the payment choice, because when it arrives is the question a
            buyer answers first - and on an international route there is nothing
            to answer, which the picker says in one line rather than an empty
            grid. */}
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground">Delivery window</Label>
          <SlotPicker slots={slots} value={slotId} onChange={setSlotId} today={today} />
        </div>

        <Separator />

        <RadioGroup
          value={method}
          onValueChange={(value) => { setMethod(value === 'mock' ? 'mock' : 'cod'); }}
          className="gap-2"
        >
          {/* WITHDRAWN, not disabled, where no courier collects cash. A greyed
              radio invites clicking; a sentence explains. The `warn` token
              rather than destructive, because this is a fact about geography
              and not a mistake the buyer made. */}
          {codAllowed ? (
            <label
              htmlFor="pay-cod"
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-wash"
            >
              <RadioGroupItem value="cod" id="pay-cod" className="mt-1" />
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Banknote className="h-4 w-4" aria-hidden="true" />
                  Cash on delivery
                </span>
                <span className="text-xs text-muted-foreground">
                  Pay {formatMoney(quote.total)} in cash when it arrives.
                </span>
              </span>
            </label>
          ) : (
            <p className="rounded-lg border border-warn/40 bg-warn-wash p-3 text-xs text-warn">
              No courier collects cash in {quote.zone?.areaName ?? 'that area'}. Pay by card
              to have it delivered there.
            </p>
          )}

          <label
            htmlFor="pay-card"
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-wash"
          >
            <RadioGroupItem value="mock" id="pay-card" className="mt-1" />
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2 text-sm font-medium">
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                Card
              </span>
              <span className="text-xs text-muted-foreground">
                Test gateway. No live card processing is connected yet.
              </span>
            </span>
          </label>
        </RadioGroup>

        {quote.requiresAgeCheck && (
          <div className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn-wash p-3">
            <Label htmlFor="dob" className="text-warn">
              Date of birth
            </Label>
            <Input
              id="dob"
              type="date"
              value={dateOfBirth}
              onChange={(event) => { setDateOfBirth(event.target.value); }}
              className="bg-card"
            />
            {/* We store WHEN the check passed, never the date itself. */}
            <p className="text-xs text-warn">
              This order contains age-restricted items. We record that the check
              passed, not your date of birth.
            </p>
          </div>
        )}

        <Separator />

        <dl className="flex flex-col gap-2 text-sm">
          <Row label="Subtotal" value={formatMoney(quote.subtotal)} />
          <Row label="Delivery" value={formatMoney(quote.shipping)} />
          <Row label="VAT" value={formatMoney(quote.tax)} />
        </dl>

        <Separator />

        <div className="flex items-baseline justify-between">
          <span className="font-medium">Total</span>
          <span className="text-2xl font-semibold tabular">{formatMoney(quote.total)}</span>
        </div>

        <Button size="lg" onClick={place} disabled={pending || ageMissing}>
          {pending && <Loader2 className="animate-spin" />}
          {method === 'cod' ? 'Place order' : 'Pay and place order'}
        </Button>

        <p className="text-xs text-muted-foreground">
          {quote.groups.length > 1
            ? `You pay once. This creates ${String(quote.groups.length)} orders, one per seller.`
            : 'You will be able to track this from your orders.'}
        </p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
