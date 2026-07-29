import { normalizeWhitespace } from "@/lib/text";

// UR-001 keystone: packages group by recipient + address + fulfillment method
// + greeting. Identical keys merge into one package; any difference splits.
// Normalized (case/whitespace-insensitive) so "Happy Purim " and "happy purim"
// group together; null and empty greeting are the same bucket.

// Address component when the package is pickup (no address row).
export const PICKUP_ADDRESS_SENTINEL = "pickup";

export interface PackageGroupInput {
  recipientName: string;
  recipientAddressId: string | null;
  fulfillmentMethodCode: string;
  greeting: string | null;
  // P8: SHIPPED guests have no address-book row — the caller passes a
  // normalized inline-address key so two same-named recipients at different
  // addresses can never merge into one label.
  addressKey?: string;
}

// Fields are JSON-encoded, not delimiter-joined: recipient/greeting are
// user-controllable, so no separator character can be safe — two inputs that
// would split differently across a delimiter must never share a key.
export function buildGroupingKey(input: PackageGroupInput): string {
  const recipient = normalizeWhitespace(input.recipientName).toLowerCase();
  const address = input.addressKey ?? input.recipientAddressId ?? PICKUP_ADDRESS_SENTINEL;
  const greeting = input.greeting ? normalizeWhitespace(input.greeting).toLowerCase() : "";
  return JSON.stringify([recipient, address, input.fulfillmentMethodCode, greeting]);
}

// Returns groups keyed by grouping key — one entry per package to create.
export function groupPackageInputs<T extends PackageGroupInput>(inputs: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const input of inputs) {
    const key = buildGroupingKey(input);
    const group = groups.get(key);
    if (group) {
      group.push(input);
    } else {
      groups.set(key, [input]);
    }
  }
  return groups;
}
