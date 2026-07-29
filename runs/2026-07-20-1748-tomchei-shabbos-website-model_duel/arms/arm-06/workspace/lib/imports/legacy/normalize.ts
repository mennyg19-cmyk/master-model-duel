import { normalizeWhitespace } from "@/lib/text";

// R-186/G-029: legacy-export normalization. The old system's exports are
// messy — mixed case, punctuation drift, phones with letters, ZIPs with
// marketing suffixes. These functions are the one place that dirt is cleaned
// (or honestly rejected); handlers stay declarative about it.

export function titleCaseName(raw: string): string {
  return normalizeWhitespace(raw)
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_all, boundary: string, letter: string) => boundary + letter.toUpperCase());
}

export function normalizeRegion(raw: string): string {
  const cleaned = normalizeWhitespace(raw);
  return cleaned.length <= 2 ? cleaned.toUpperCase() : titleCaseName(cleaned);
}

// US ZIPs arrive as "08701", "08701-1234", "08701 " — normalize to 5 or 5+4.
// Anything else returns null so the caller can flag review instead of writing
// a poisoned ZIP into the book.
export function normalizeZip(raw: string): string | null {
  const cleaned = normalizeWhitespace(raw).replace(/\s+/g, "");
  const match = /^(\d{5})(?:-?(\d{4}))?$/.exec(cleaned);
  if (!match) return null;
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}

// Looser than lib/customers/addresses.ts addressDedupeKey: punctuation and
// street-suffix drift ("Main St." vs "main street" stays distinct, but
// "123 Main St." vs "123 main st" collapse). The cleanup scanner uses this
// for near-duplicate REVIEW groups; exact merges still use the strict key.
export function legacyAddressGroupKey(input: {
  line1: string;
  city: string;
  postalCode: string;
}): string {
  const line = normalizeWhitespace(input.line1)
    .toLowerCase()
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const city = normalizeWhitespace(input.city).toLowerCase();
  const zip = (normalizeZip(input.postalCode) ?? input.postalCode).slice(0, 5);
  return `${line}|${city}|${zip}`;
}
