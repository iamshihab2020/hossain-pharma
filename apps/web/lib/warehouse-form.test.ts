import { describe, expect, it } from 'vitest';
import { parseWarehouseForm } from './warehouse-form';

function form(overrides: Record<string, string> = {}, flags: string[] = []): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    name: 'Dhaka depot',
    addressLine: '12 Elephant Road',
    city: 'Dhaka',
    district: 'Dhaka',
    postcode: '1205',
    contactPhone: '+8801700000000',
    priority: '0',
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== '') data.set(key, value);
    else data.set(key, '');
  }
  for (const flag of flags) data.set(flag, 'on');
  return data;
}

describe('parseWarehouseForm', () => {
  it('turns a filled form into a typed request', () => {
    const result = parseWarehouseForm(form());
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Dhaka depot',
        addressLine: '12 Elephant Road',
        city: 'Dhaka',
        district: 'Dhaka',
        postcode: '1205',
        countryCode: 'BD',
        contactPhone: '+8801700000000',
        isDefault: false,
        isPickupPoint: false,
        priority: 0,
      },
    });
  });

  it('trims what people paste', () => {
    const result = parseWarehouseForm(form({ name: '  Dhaka depot  ' }));
    expect(result.ok && result.value.name).toBe('Dhaka depot');
  });

  it('defaults the country rather than demanding it', () => {
    // This marketplace delivers in Bangladesh. A field every seller types the
    // same value into is wrong more often than it is useful.
    const result = parseWarehouseForm(form());
    expect(result.ok && result.value.countryCode).toBe('BD');
  });

  it('upper-cases a country typed in lower case', () => {
    const result = parseWarehouseForm(form({ countryCode: 'bd' }));
    expect(result.ok && result.value.countryCode).toBe('BD');
  });

  it('reads checkboxes by PRESENCE, not by value', () => {
    // An unchecked checkbox is absent from FormData entirely; a checked one is
    // "on". Comparing to 'true' would make both read as false.
    const result = parseWarehouseForm(form({}, ['isDefault', 'isPickupPoint']));
    expect(result.ok && result.value.isDefault).toBe(true);
    expect(result.ok && result.value.isPickupPoint).toBe(true);
  });

  it.each([
    ['name', 'a name'],
    ['addressLine', 'a street address'],
    ['city', 'a city'],
    ['district', 'a district'],
    ['contactPhone', 'a contact phone number'],
  ])('asks for %s when it is missing', (field, label) => {
    const result = parseWarehouseForm(form({ [field]: '' }));
    expect(result).toEqual({ ok: false, error: `Enter ${label}.` });
  });

  it('rejects something that is not a postcode', () => {
    expect(parseWarehouseForm(form({ postcode: '12' }))).toMatchObject({ ok: false });
    expect(parseWarehouseForm(form({ postcode: '12/05' }))).toMatchObject({ ok: false });
    // A UK postcode has a space in it and must still pass.
    expect(parseWarehouseForm(form({ postcode: 'E1 6AN' }))).toMatchObject({ ok: true });
  });

  it('rejects a country that is not two letters', () => {
    // Asserted by reading the field rather than with `expect.stringContaining`,
    // which is typed `any` and trips no-unsafe-assignment inside toMatchObject.
    const result = parseWarehouseForm(form({ countryCode: 'BGD' }));
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('two-letter');
  });

  it('rejects a priority that is not a whole number at or above zero', () => {
    expect(parseWarehouseForm(form({ priority: '-1' }))).toMatchObject({ ok: false });
    expect(parseWarehouseForm(form({ priority: 'soon' }))).toMatchObject({ ok: false });
    expect(parseWarehouseForm(form({ priority: '3' }))).toMatchObject({ ok: true });
  });

  it('treats an omitted priority as first in line', () => {
    const result = parseWarehouseForm(form({ priority: '' }));
    expect(result.ok && result.value.priority).toBe(0);
  });
});
