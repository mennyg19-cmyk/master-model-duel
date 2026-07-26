/**
 * Reading a form field the way every action in the app wants it: a string, with
 * the spaces off. A field the browser never sent and a field the customer left
 * blank are the same empty answer, so both come back as `''`.
 */
export function trimmedField(formData: FormData, field: string): string {
  return String(formData.get(field) ?? '').trim();
}

/**
 * The optimistic-concurrency stamp the screen was drawn with, or null when the
 * field is missing or is not a version any row could hold. Null rather than a
 * number no row matches, so each caller refuses in the way its screen expects
 * instead of the two of them drifting apart.
 */
export function readVersionStamp(formData: FormData): number | null {
  const raw = trimmedField(formData, 'version');
  return /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}
