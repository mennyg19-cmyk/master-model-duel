export type GroupingAddress = {
  recipientName: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
};

export type GroupingInput = GroupingAddress & {
  fulfillmentMethodCode: string;
  greeting?: string | null;
};

function normalizePart(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Stable key: recipient + address + fulfillment method + greeting. */
export function buildGroupingKey(input: GroupingInput): string {
  const parts = [
    normalizePart(input.recipientName),
    normalizePart(input.addressLine1),
    normalizePart(input.addressLine2),
    normalizePart(input.city),
    normalizePart(input.state),
    normalizePart(input.postalCode),
    normalizePart(input.country ?? "US"),
    normalizePart(input.fulfillmentMethodCode),
    normalizePart(input.greeting),
  ];
  return parts.join("|");
}

export function groupLinesByKey<T extends { groupingKey: string }>(
  lines: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const line of lines) {
    const existing = groups.get(line.groupingKey);
    if (existing) {
      existing.push(line);
    } else {
      groups.set(line.groupingKey, [line]);
    }
  }
  return groups;
}
