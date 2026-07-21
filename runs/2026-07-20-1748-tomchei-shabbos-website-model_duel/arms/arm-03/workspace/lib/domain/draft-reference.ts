import { randomBytes } from "node:crypto";

// Draft reference numbers (R-047): the customer-facing handle before an order
// gets its sequential number. Unambiguous alphabet (no 0/O/1/I) so it survives
// being read over the phone.
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function newDraftReference(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) code += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `D-${code}`;
}

// Wire format (R-047): what a customer puts on a bank transfer so staff can
// match the payment to the draft.
export function wireFormat(draftReference: string): string {
  return `TOMCHEI ${draftReference}`;
}
