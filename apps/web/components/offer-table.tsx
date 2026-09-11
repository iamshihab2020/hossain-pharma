'use client';

import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { PublicBuyBox, PublicOffer } from '@nexmarket/api-client';
import { addToCart } from '@/app/actions/cart';
import { formatDispatch, formatMoney } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * THE COMPARISON. This is the screen the whole system exists to produce.
 *
 * Every other marketplace shows one price and buries the rest behind a link
 * nobody opens. Ours opens with the competition, because the API already ranks
 * it honestly - `buy-box.ts` is a pure, tested function that ranks on LANDED
 * price, and the seed proves the point: the cheapest sticker price does not
 * win once delivery lands on top.
 *
 * Alignment does the work colour usually does. Four columns, right-aligned
 * numbers, tabular figures, so the eye can scan DOWN a column as easily as
 * across a row.
 *
 * The one animation in the whole storefront lives here: choosing a different
 * seller moves the total. Motion answers an action or it does not appear.
 */
export function OfferTable({
  buyBox,
  productName,
}: {
  buyBox: PublicBuyBox;
  productName: string;
}): ReactNode {
  const [selectedId, setSelectedId] = useState(buyBox.winner?.listingId ?? null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  if (buyBox.offers.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          Nobody is selling this right now. Try a similar product below.
        </AlertDescription>
      </Alert>
    );
  }

  const selected = buyBox.offers.find((offer) => offer.listingId === selectedId) ?? buyBox.offers[0];

  function submit(): void {
    if (selected === undefined) return;
    setError(null);
    startTransition(async () => {
      const result = await addToCart(selected.listingId, 1);
      if (result.ok) {
        setAdded(true);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">
          {buyBox.offers.length === 1
            ? 'One seller has this'
            : `${String(buyBox.offers.length)} sellers have this`}
        </h2>
      </div>

      {/* Wide content scrolls in its own container so the page body never does. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-sunk hover:bg-sunk">
              <TableHead className="w-[42%]">Seller</TableHead>
              <TableHead className="text-right">Delivered price</TableHead>
              <TableHead className="text-right">Dispatch</TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {buyBox.offers.map((offer) => (
              <OfferRow
                key={offer.listingId}
                offer={offer}
                selected={offer.listingId === selected?.listingId}
                onSelect={() => { setSelectedId(offer.listingId); setAdded(false); }}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-muted-foreground">
        Ranked by delivered price. Delivery is each seller&rsquo;s flat rate
        until we quote your address at checkout.
      </p>

      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {selected !== undefined && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-2xl font-semibold tabular transition-[color,transform] duration-200">
              {formatMoney(selected.landedPrice)}
            </p>
            {/* Naming the seller on the buy button is not decoration. On a
                marketplace, "Add to cart" without a seller name is a trap. */}
            <p className="truncate text-sm text-muted-foreground">
              {/* The seller's name is a LINK now that they have a page. Phase 7
                  gave them a storefront with their rating on it, and "who am I
                  buying from" is the question a shopper asks at exactly this
                  point - standing over the Add button, having just been told a
                  name they may not recognise. */}
              Sold by{' '}
              <Link
                href={`/s/${selected.seller.slug}`}
                className="text-foreground underline-offset-2 hover:underline"
              >
                {selected.seller.displayName}
              </Link>{' '}
              · {formatDispatch(selected.dispatchDays)}
            </p>
          </div>
          <Button onClick={submit} disabled={pending} size="lg" className="shrink-0">
            {pending && <Loader2 className="animate-spin" />}
            {added && !pending && <Check />}
            {added && !pending ? 'Added to cart' : `Add ${productName === '' ? 'to cart' : 'to cart'}`}
          </Button>
        </div>
      )}
    </div>
  );
}

function OfferRow({
  offer,
  selected,
  onSelect,
}: {
  offer: PublicOffer;
  selected: boolean;
  onSelect: () => void;
}): ReactNode {
  const hasShipping = offer.shipping.amount > 0;

  return (
    <TableRow
      onClick={onSelect}
      // The whole row is the target, but it also has to be reachable and
      // operable from a keyboard, so it carries the radio semantics rather than
      // relying on the click handler alone.
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'cursor-pointer',
        selected && 'bg-wash hover:bg-wash',
        offer.isWinner && 'shadow-[inset_3px_0_0_hsl(var(--primary))]',
      )}
    >
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{offer.seller.displayName}</span>
          {offer.isWinner && <Badge>Best delivered price</Badge>}
          {offer.availability === 'LOW_STOCK' && (
            <Badge variant="outline" className="border-warn/40 bg-warn-wash text-warn">
              Low stock
            </Badge>
          )}
        </div>
      </TableCell>

      <TableCell className="text-right">
        <div className="font-semibold tabular">{formatMoney(offer.landedPrice)}</div>
        <div className="text-xs text-muted-foreground tabular">
          {formatMoney(offer.price)}
          {hasShipping ? ` + ${formatMoney(offer.shipping)} delivery` : ' + free delivery'}
        </div>
      </TableCell>

      <TableCell className="text-right text-sm">{formatDispatch(offer.dispatchDays)}</TableCell>

      <TableCell className="pr-4">
        <span
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded-full border',
            selected ? 'border-primary bg-primary' : 'border-line-strong',
          )}
          aria-hidden="true"
        >
          {selected && <Check className="h-3 w-3 text-primary-foreground" />}
        </span>
      </TableCell>
    </TableRow>
  );
}
