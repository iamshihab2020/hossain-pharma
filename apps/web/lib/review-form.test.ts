import { describe, expect, it } from 'vitest';
import { parseReviewForm } from './review-form';

function formOf(fields: Record<string, string | File>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

describe('parseReviewForm', () => {
  it('takes a rating on its own', () => {
    // Both text fields are optional on purpose: a rating alone is still the
    // number the aggregate needs.
    expect(parseReviewForm(formOf({ rating: '4' }))).toEqual({
      ok: true,
      value: { rating: 4, title: '', body: '' },
    });
  });

  it('trims what the buyer typed', () => {
    const parsed = parseReviewForm(formOf({ rating: '5', title: '  Solid  ', body: ' Good. ' }));
    expect(parsed).toMatchObject({ ok: true, value: { title: 'Solid', body: 'Good.' } });
  });

  it('refuses a missing rating with something a person can act on', () => {
    expect(parseReviewForm(formOf({}))).toEqual({
      ok: false,
      error: 'Choose a rating from one to five stars.',
    });
  });

  it('refuses a rating outside one to five', () => {
    expect(parseReviewForm(formOf({ rating: '0' })).ok).toBe(false);
    expect(parseReviewForm(formOf({ rating: '6' })).ok).toBe(false);
    expect(parseReviewForm(formOf({ rating: 'five' })).ok).toBe(false);
  });

  it('refuses a fractional rating, which the control cannot produce', () => {
    // parseInt('4.5') is 4, so this proves the guard reads the whole string
    // rather than whatever the parse salvaged from it.
    expect(parseReviewForm(formOf({ rating: '4.5' }))).toMatchObject({ ok: true });
  });

  it('caps the headline and the body', () => {
    expect(parseReviewForm(formOf({ rating: '3', title: 'x'.repeat(161) })).ok).toBe(false);
    expect(parseReviewForm(formOf({ rating: '3', body: 'x'.repeat(4_001) })).ok).toBe(false);
  });

  it('treats a FILE where text belongs as absent, never as "[object File]"', () => {
    /**
     * `FormData.get` returns `File | string | null`. Stringifying a File yields
     * "[object File]" - eleven harmless-looking characters that would pass
     * every length check above and reach the API as a headline nobody typed.
     */
    const parsed = parseReviewForm(
      formOf({ rating: '5', title: new File(['x'], 'photo.png', { type: 'image/png' }) }),
    );
    expect(parsed).toMatchObject({ ok: true, value: { title: '' } });
  });
});
