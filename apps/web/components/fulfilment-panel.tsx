'use client';

import { useState, useTransition, type ReactNode } from 'react';
import type { OrderDetail, OrderItemView } from '@nexmarket/api-client';
import {
  acceptOrder,
  cancelLines,
  dispatchShipment,
  markDelivered,
  rejectOrder,
  type ActionResult,
} from '@/app/actions/fulfilment';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { canAccept, canCancel, canReject } from '@/lib/order-timeline';

/**
 * What the seller can do to this order, right now.
 *
 * Only the verbs the order can actually take are rendered. A disabled row of
 * every possible button teaches the seller nothing about where the order is,
 * and a button that returns 409 is worse than a button that is not there.
 */
export function FulfilmentPanel({
  order,
  tenantId,
  outstanding,
}: {
  order: OrderDetail;
  tenantId: string;
  outstanding: { item: OrderItemView; remaining: number }[];
}): ReactNode {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const perform = (run: () => Promise<ActionResult>): void => {
    setError(null);
    start(() => {
      void run().then((result) => {
        if (!result.ok) setError(result.message);
      });
    });
  };

  const canShip =
    outstanding.length > 0 &&
    (order.status === 'ACCEPTED' || order.status === 'PARTIALLY_SHIPPED');

  const acceptable = canAccept(order.status, order.paymentMethod);

  return (
    <div className="flex flex-col gap-6">
      {error !== null && (
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
      )}

      {canReject(order.status) && (
        <section className="flex flex-col gap-3">
          {/* A CASH order is acceptable while still awaiting payment - that is
              what cash on delivery means - and an unpaid CARD order is not.
              Same status, and the payment method is what tells them apart. */}
          {acceptable && (
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                perform(() => acceptOrder(tenantId, order.id));
              }}
            >
              {order.paymentMethod === 'cod'
                ? 'Accept and collect cash on delivery'
                : 'Accept this order'}
            </Button>
          )}

          <form
            action={(form: FormData) => {
              perform(() => rejectOrder(tenantId, order.id, form));
            }}
            className="flex flex-col gap-2"
          >
            {/* "Or" only when there is something to say "or" to. An unpaid
                card order shows no accept button, and a lone "Or decline it"
                reads as a missing control rather than the only one. */}
            <Label htmlFor="reject-reason" className="text-sm text-muted-foreground">
              {acceptable
                ? 'Or decline it, and tell the buyer why'
                : 'This has not been paid for. Decline it, and tell the buyer why'}
            </Label>
            <div className="flex gap-2">
              <Input
                id="reject-reason"
                name="reason"
                placeholder="Out of stock at the warehouse"
                required
              />
              <Button type="submit" variant="outline" disabled={pending}>
                Decline
              </Button>
            </div>
          </form>
        </section>
      )}

      {canShip && (
        <form
          action={(form: FormData) => {
            perform(() => dispatchShipment(tenantId, order.id, form));
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <h3 className="text-sm font-medium">Send a parcel</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Set a quantity for everything going in this box. Leave a line at zero to send it
              later.
            </p>
          </div>

          <ul className="flex flex-col gap-2">
            {outstanding.map(({ item, remaining }) => (
              <li key={item.id} className="flex items-center justify-between gap-4">
                <Label htmlFor={`qty-${item.id}`} className="text-sm font-normal">
                  {item.productName}
                  <span className="ml-2 text-muted-foreground">{remaining} left to send</span>
                </Label>
                <Input
                  id={`qty-${item.id}`}
                  name={`qty:${item.id}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={remaining}
                  defaultValue={remaining}
                  className="w-20 tabular"
                />
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <Input name="carrierName" placeholder="Carrier (optional)" className="max-w-[12rem]" />
            <Input
              name="trackingNumber"
              placeholder="Tracking number (optional)"
              className="max-w-[14rem]"
            />
          </div>

          <Button type="submit" disabled={pending} className="self-start">
            Dispatch parcel
          </Button>
        </form>
      )}

      {order.shipments.some((shipment) => shipment.status === 'DISPATCHED') && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Mark a parcel delivered</h3>
          {order.shipments
            .filter((shipment) => shipment.status === 'DISPATCHED')
            .map((shipment) => (
              <Button
                key={shipment.id}
                type="button"
                variant="outline"
                disabled={pending}
                className="self-start font-mono"
                onClick={() => {
                  perform(() => markDelivered(tenantId, order.id, shipment.id));
                }}
              >
                {shipment.shipmentNumber} arrived
              </Button>
            ))}
        </section>
      )}

      {outstanding.length > 0 && canCancelLines(order.status) && (
        <form
          action={(form: FormData) => {
            perform(() => cancelLines(tenantId, order.id, form));
          }}
          className="flex flex-col gap-2 border-t border-border pt-4"
        >
          <Label htmlFor="cancel-reason" className="text-sm text-muted-foreground">
            Cannot send the rest? Cancel what is left, and say why
          </Label>
          <div className="flex gap-2">
            <Input
              id="cancel-reason"
              name="reason"
              placeholder="Damaged in the warehouse"
              required
            />
            <Button type="submit" variant="outline" disabled={pending}>
              Cancel remaining
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Line cancellation is open wider than a whole-order cancel: a partly shipped
 *  order can still lose its remainder, which lands it on SHIPPED. */
function canCancelLines(status: OrderDetail['status']): boolean {
  return canCancel(status) || status === 'PARTIALLY_SHIPPED';
}
