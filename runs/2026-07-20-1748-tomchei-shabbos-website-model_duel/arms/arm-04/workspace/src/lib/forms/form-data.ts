/**
 * Reading a form field the way every action in the app wants it: a string, with
 * the spaces off. A field the browser never sent and a field the customer left
 * blank are the same empty answer, so both come back as `''`.
 */
export function trimmedField(formData: FormData, field: string): string {
  return String(formData.get(field) ?? '').trim();
}
