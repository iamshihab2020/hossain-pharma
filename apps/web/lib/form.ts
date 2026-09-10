/**
 * Reads a text field out of a FormData.
 *
 * `FormData.get()` returns `string | File | null`, so `String(...)` on it turns
 * an uploaded file into the literal text "[object File]" - a value that passes
 * every string check downstream and means nothing. The typed-lint rule that
 * caught this was right: a field is text or it is absent, and a File in a text
 * field is a caller error rather than something to coerce.
 */
export function textField(form: FormData, name: string, fallback = ''): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : fallback;
}

/** The same, but an empty field reads as "not supplied" rather than "". */
export function optionalTextField(form: FormData, name: string): string | undefined {
  const value = textField(form, name).trim();
  return value === '' ? undefined : value;
}
