import { describe, expect, it } from 'vitest';
import { parseReasonForm, parseShipmentForm } from './shipment-form.js';

const KEY = 'idem-1234-5678';

function formOf(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

describe('parseShipmentForm', () => {
  it('refuses a parcel with nothing in it', () => {
    const result = parseShipmentForm(new FormData(), KEY);
    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toMatch(/at least one/i);
  });

  it('drops zero-quantity lines rather than sending them', () => {
    // Zero means "not in this parcel". Sending it would make the API refuse a
    // line the seller never asked to send.
    const result = parseShipmentForm(formOf({ 'qty:item-1': '0', 'qty:item-2': '2' }), KEY);
    expect(result.ok && result.value.items).toEqual([{ orderItemId: 'item-2', quantity: 2 }]);
  });

  it('refuses a fractional or negative quantity', () => {
    expect(parseShipmentForm(formOf({ 'qty:item-1': '1.5' }), KEY).ok).toBe(false);
    expect(parseShipmentForm(formOf({ 'qty:item-1': '-1' }), KEY).ok).toBe(false);
  });

  it('refuses a quantity that is not a number at all', () => {
    expect(parseShipmentForm(formOf({ 'qty:item-1': 'two' }), KEY).ok).toBe(false);
  });

  it('carries the idempotency key it was given', () => {
    // Generated once per rendered form, so a double-submitted dispatch returns
    // the original parcel instead of shipping - and paying - twice.
    const result = parseShipmentForm(formOf({ 'qty:item-1': '1' }), KEY);
    expect(result.ok && result.value.idempotencyKey).toBe(KEY);
  });

  it('omits carrier and tracking rather than sending empty strings', () => {
    const result = parseShipmentForm(
      formOf({ 'qty:item-1': '1', carrierName: '  ', trackingNumber: '' }),
      KEY,
    );
    expect(result.ok && 'carrierName' in result.value).toBe(false);
    expect(result.ok && 'trackingNumber' in result.value).toBe(false);
  });

  it('trims a carrier name that a human typed with a trailing space', () => {
    const result = parseShipmentForm(formOf({ 'qty:item-1': '1', carrierName: 'Pathao ' }), KEY);
    expect(result.ok && result.value.carrierName).toBe('Pathao');
  });

  it('ignores fields that are not quantities', () => {
    const result = parseShipmentForm(formOf({ 'qty:item-1': '1', note: 'hello' }), KEY);
    expect(result.ok && result.value.items).toHaveLength(1);
  });
});

describe('parseReasonForm', () => {
  it('requires a reason', () => {
    const result = parseReasonForm(new FormData());
    expect(result.ok).toBe(false);
    // The buyer is the one who reads this, so the message says why it matters.
    expect(result.ok || result.error).toMatch(/buyer/i);
  });

  it('refuses whitespace as a reason', () => {
    expect(parseReasonForm(formOf({ reason: '   ' })).ok).toBe(false);
  });

  it('trims the reason it accepts', () => {
    const result = parseReasonForm(formOf({ reason: ' Out of stock ' }));
    expect(result.ok && result.value).toBe('Out of stock');
  });
});
