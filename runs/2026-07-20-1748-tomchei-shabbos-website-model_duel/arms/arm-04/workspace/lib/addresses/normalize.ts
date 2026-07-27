import { z } from "zod";

// Server-side address validation (R-025). Every recipient address — builder
// dialog, account page, staff edit — goes through this schema.
export const addressInputSchema = z.object({
  recipient: z.string().trim().min(2, "Recipient name is required"),
  label: z.string().trim().max(60).optional(),
  line1: z.string().trim().min(3, "Street address is required"),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2, "City is required"),
  state: z
    .string()
    .trim()
    .length(2, "State is the 2-letter code (e.g. NJ)")
    .transform((state) => state.toUpperCase()),
  zip: z.string().trim().regex(/^\d{5}$/, "ZIP is 5 digits"),
});

export type AddressInput = z.infer<typeof addressInputSchema>;

// Common street-suffix spellings collapse to one form so "Main Street" and
// "Main St." dedupe to the same key.
const SUFFIX_ALIASES: Record<string, string> = {
  street: "st",
  avenue: "ave",
  av: "ave",
  road: "rd",
  drive: "dr",
  lane: "ln",
  court: "ct",
  boulevard: "blvd",
  place: "pl",
  terrace: "ter",
  circle: "cir",
  highway: "hwy",
};

function normalizePart(part: string): string {
  return part
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => SUFFIX_ALIASES[word] ?? word)
    .join(" ");
}

/**
 * The dedupe key (UR-014): recipient + full address, lowercased, punctuation
 * stripped, suffixes collapsed. Two saves of the same place under one customer
 * hit the (customerId, normalizedKey) unique and merge instead of duplicating.
 */
export function normalizedAddressKey(address: AddressInput): string {
  return [
    normalizePart(address.recipient),
    normalizePart(address.line1),
    normalizePart(address.line2 ?? ""),
    normalizePart(address.city),
    address.state.toLowerCase(),
    address.zip,
  ].join("|");
}
