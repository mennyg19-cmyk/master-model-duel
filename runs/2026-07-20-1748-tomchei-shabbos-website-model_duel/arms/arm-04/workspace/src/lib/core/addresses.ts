/**
 * What makes an address undeliverable, decided once (UR-014).
 *
 * The legacy import asks this question on the way in and the cleanup queue asks
 * it again on every rescan. They have to agree: a donor flagged as broken by the
 * import and silently un-flagged by the next scan is a queue the office stops
 * believing.
 *
 * ZIP+4 is a ZIP code here. The forms normalize "08701-1234" down to "08701"
 * before storing it (`normalizePostalCode`), but a decade of rows typed into the
 * old system were never normalized, and calling those broken would put real,
 * deliverable addresses in front of a volunteer to "fix".
 */
export const STATE_CODE = /^[A-Z]{2}$/;

export const ZIP_CODE = /^(\d{5})(?:-\d{4})?$/;

export type PostalAddress = {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
};

/** The reason it cannot be delivered to as written, in the words the queue shows. */
export function addressProblem(address: PostalAddress): string | null {
  if (address.line1.trim() === '') return 'No street address.';
  if (address.city.trim() === '') return 'No city.';
  if (!STATE_CODE.test(address.state.trim().toUpperCase())) return 'The state is not a two-letter code.';
  if (!ZIP_CODE.test(address.postalCode.trim())) {
    return 'The ZIP code is not five digits, or five plus four.';
  }

  return null;
}
