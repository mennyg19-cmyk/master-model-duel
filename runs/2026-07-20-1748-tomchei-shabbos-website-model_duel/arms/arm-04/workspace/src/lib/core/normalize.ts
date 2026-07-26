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
    .map((part) => canonicalizeWords(collapseToLetters(part)))
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

/**
 * How people actually write the same street. Without this, "12 Main St." and
 * "12 Main Street" are two rows in one address book, two geocode lookups and two
 * packages to one door — the whole reason the key exists.
 *
 * Only unambiguous forms are listed. "St" doubles as Saint, which collapses onto
 * the same token and costs nothing: two spellings of one address is the outcome
 * this is for.
 */
const ADDRESS_WORDS: Record<string, string> = {
  street: 'st',
  str: 'st',
  saint: 'st',
  avenue: 'ave',
  av: 'ave',
  road: 'rd',
  drive: 'dr',
  lane: 'ln',
  boulevard: 'blvd',
  court: 'ct',
  place: 'pl',
  circle: 'cir',
  terrace: 'ter',
  parkway: 'pkwy',
  highway: 'hwy',
  apartment: 'apt',
  unit: 'apt',
  suite: 'apt',
  ste: 'apt',
  floor: 'fl',
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
};

function canonicalizeWords(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => ADDRESS_WORDS[word] ?? word)
    .join(' ');
}
