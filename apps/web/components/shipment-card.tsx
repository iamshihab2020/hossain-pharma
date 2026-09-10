import type { ReactNode } from 'react';
import type { OrderItemView, ShipmentView } from '@nexmarket/api-client';
import { describeShipment } from '@/lib/order-timeline';
import { formatDate } from '@/lib/format';
import { plural } from '@/lib/format';

/**
 * One parcel.
 *
 * The tracking number is the most useful string on this page once a box is
 * moving, so it is set in the mono face at full contrast rather than filed
 * under metadata. There is no carrier logo and no map: Phase 6 brings real
 * tracking events, and a progress bar drawn over data we do not have would be
 * a picture of a guess.
 */
export function ShipmentCard({
  shipment,
  items,
}: {
  shipment: ShipmentView;
  items: readonly OrderItemView[];
}): ReactNode {
  const delivered = shipment.status === 'DELIVERED';
  const byId = new Map(items.map((item) => [item.id, item]));

  return (
    <li className="rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium">
          {delivered ? 'Delivered' : 'On its way'}
          <span className="ml-2 font-normal text-muted-foreground">
            {describeShipment(shipment)}
          </span>
        </p>
        <time
          dateTime={delivered ? (shipment.deliveredAt ?? shipment.dispatchedAt) : shipment.dispatchedAt}
          className="text-xs tabular text-muted-foreground"
        >
          {delivered && shipment.deliveredAt !== null
            ? formatDate(shipment.deliveredAt)
            : formatDate(shipment.dispatchedAt)}
        </time>
      </div>

      {shipment.trackingNumber !== null && (
        <p className="mt-2 font-mono text-sm">{shipment.trackingNumber}</p>
      )}

      <ul className="mt-3 flex flex-col gap-1">
        {shipment.items.map((line) => {
          const item = byId.get(line.orderItemId);
          return (
            <li key={line.orderItemId} className="text-sm text-muted-foreground">
              {item?.productName ?? 'Item'}
              <span className="tabular"> · {plural(line.quantity, 'unit', 'units')}</span>
            </li>
          );
        })}
      </ul>
    </li>
  );
}
