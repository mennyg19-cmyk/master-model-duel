// Phone normalization for customer dedupe (R-144): digits only, US default.
// " (347) 555-0132" → "+13475550132". Returns null when the input has no
// plausible E.164 shape (E.164 caps at 15 digits; fewer than 10 can't carry a
// country+subscriber pair) — a garbage string must not become a dedupe key
// that collides with a real number.
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}
