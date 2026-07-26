/** Normalized forms used as dedupe keys for customers and address books. */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type AddressParts = {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
};

/**
 * Collapses "12 Main St., Apt 4" and "12 main street apt 4" to the same string.
 * It keys the address book, the package grouping key and the geocode cache, so
 * all three agree on when two addresses are the same place.
 *
 * Empty segments are kept in position rather than dropped, so a missing unit
 * number cannot shift the city into the street slot.
 */
export function normalizeAddressKey(parts: AddressParts): string {
  return [parts.line1, parts.line2, parts.city, parts.state, parts.postalCode, parts.country ?? 'US']
    .map((part) => collapseToLetters(part))
    .join('|');
}

/** Same treatment for a person's name: case and punctuation must not split a package. */
export function normalizeName(name: string): string {
  return collapseToLetters(name);
}

function collapseToLetters(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
