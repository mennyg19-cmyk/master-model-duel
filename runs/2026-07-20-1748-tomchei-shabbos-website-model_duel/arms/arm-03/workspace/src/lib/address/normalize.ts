export type AddressParts = {
  recipientName: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
};

function part(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Stable ownership-scoped dedupe key for SavedAddress. */
export function buildAddressNorm(input: AddressParts): string {
  return [
    part(input.recipientName),
    part(input.line1),
    part(input.line2),
    part(input.city),
    part(input.state),
    part(input.postalCode),
    part(input.country ?? "US"),
  ].join("|");
}

const STATE_RE = /^[A-Za-z]{2}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

export function validateAddressInput(input: AddressParts): string | null {
  if (!input.recipientName.trim()) return "Recipient name is required.";
  if (!input.line1.trim()) return "Street address is required.";
  if (!input.city.trim()) return "City is required.";
  if (!STATE_RE.test(input.state.trim())) return "State must be a 2-letter code.";
  if (!ZIP_RE.test(input.postalCode.trim())) return "Enter a valid US ZIP code.";
  const country = (input.country ?? "US").trim().toUpperCase();
  if (country !== "US") return "Only US addresses are supported in this phase.";
  return null;
}
