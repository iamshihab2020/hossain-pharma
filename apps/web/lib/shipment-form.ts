/**
 * Reading a dispatch form.
 *
 * Pure, and separated from the server action for the reason `order-timeline.ts`
 * gives: this is the part with decisions in it, so this is the part that gets
 * tested. The action around it is a fetch.
 */

export type ShipmentLine = { orderItemId: string; quantity: number };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type ShipmentForm = {
  items: ShipmentLine[];
  carrierName?: string;
  trackingNumber?: string;
  idempotencyKey: string;
};

/** Quantity inputs are named `qty:<orderItemId>`, one per line on the order. */
const QUANTITY_PREFIX = 'qty:';

export function parseShipmentForm(form: FormData, idempotencyKey: string): ParseResult<ShipmentForm> {
  const items: ShipmentLine[] = [];

  for (const [key, raw] of form.entries()) {
    if (!key.startsWith(QUANTITY_PREFIX)) continue;
    const orderItemId = key.slice(QUANTITY_PREFIX.length);
    if (orderItemId === '') return { ok: false, error: 'A quantity field is missing its line.' };

    // A FormData value is a string OR a File. A File here means the form was
    // tampered with or renamed a field; either way it is not a quantity.
    if (typeof raw !== 'string') {
      return { ok: false, error: 'Quantities must be whole numbers.' };
    }
    const quantity = Number(raw.trim());
    if (!Number.isInteger(quantity) || quantity < 0) {
      return { ok: false, error: 'Quantities must be whole numbers.' };
    }
    // Zero means "not in this parcel". Dropped rather than sent, because the
    // API refuses a zero-quantity line and it would be refusing a line the
    // seller never asked to send.
    if (quantity > 0) items.push({ orderItemId, quantity });
  }

  if (items.length === 0) {
    return { ok: false, error: 'Add at least one item to this parcel.' };
  }

  const carrierName = trimmed(form.get('carrierName'));
  const trackingNumber = trimmed(form.get('trackingNumber'));

  return {
    ok: true,
    value: {
      items,
      ...(carrierName === null ? {} : { carrierName }),
      ...(trackingNumber === null ? {} : { trackingNumber }),
      idempotencyKey,
    },
  };
}

/** A cancellation says why, and the API refuses one that does not. */
export function parseReasonForm(form: FormData): ParseResult<string> {
  const reason = trimmed(form.get('reason'));
  if (reason === null) {
    return { ok: false, error: 'Say why, so the buyer is told something useful.' };
  }
  return { ok: true, value: reason };
}

function trimmed(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}
