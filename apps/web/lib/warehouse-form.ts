/**
 * Parsing and validating the warehouse form, as plain functions.
 *
 * Same convention as `shipment-form.ts`: a Server Action receives `FormData`,
 * which is all strings, and turning that into a typed request is where the
 * mistakes live - so it happens here, in something a test can drive with plain
 * values, rather than inside the action.
 *
 * This validates so the buyer sees a useful message without a round trip. The
 * API validates again because a request body is not a form, and neither is the
 * other's backup.
 */

export type WarehouseFormValue = {
  name: string;
  addressLine: string;
  city: string;
  district: string;
  postcode: string;
  countryCode: string;
  contactPhone: string;
  isDefault: boolean;
  isPickupPoint: boolean;
  priority: number;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const REQUIRED: { field: keyof WarehouseFormValue; label: string }[] = [
  { field: 'name', label: 'a name' },
  { field: 'addressLine', label: 'a street address' },
  { field: 'city', label: 'a city' },
  { field: 'district', label: 'a district' },
  { field: 'postcode', label: 'a postcode' },
  { field: 'contactPhone', label: 'a contact phone number' },
];

export function parseWarehouseForm(form: FormData): ParseResult<WarehouseFormValue> {
  const value: WarehouseFormValue = {
    name: text(form, 'name'),
    addressLine: text(form, 'addressLine'),
    city: text(form, 'city'),
    district: text(form, 'district'),
    postcode: text(form, 'postcode'),
    // Defaulted rather than required: this marketplace delivers in Bangladesh,
    // and asking every seller to type BD is a field that is wrong more often
    // than it is useful.
    countryCode: (text(form, 'countryCode') || 'BD').toUpperCase(),
    contactPhone: text(form, 'contactPhone'),
    isDefault: form.get('isDefault') !== null,
    isPickupPoint: form.get('isPickupPoint') !== null,
    priority: Number.parseInt(text(form, 'priority') || '0', 10),
  };

  for (const { field, label } of REQUIRED) {
    if (value[field] === '') return { ok: false, error: `Enter ${label}.` };
  }

  if (!/^[A-Za-z0-9 ]{3,12}$/.test(value.postcode)) {
    return { ok: false, error: 'That does not look like a postcode.' };
  }
  if (!/^[A-Z]{2}$/.test(value.countryCode)) {
    return { ok: false, error: 'Country must be a two-letter code, like BD.' };
  }
  if (!Number.isInteger(value.priority) || value.priority < 0) {
    return { ok: false, error: 'Priority must be a whole number, 0 or more.' };
  }

  return { ok: true, value };
}

function text(form: FormData, key: string): string {
  const raw = form.get(key);
  return typeof raw === 'string' ? raw.trim() : '';
}
