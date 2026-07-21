// Package grouping engine (UR-001). Lines going to the same recipient, at the
// same address, by the same method, with the same greeting merge into one
// package; any difference (including greeting text) splits them.

export type GroupingFields = {
  recipientName: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  zip: string;
  fulfillmentMethodId: string;
  greeting: string;
};

function normalize(part: string | null | undefined): string {
  return (part ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function packageGroupingKey(fields: GroupingFields): string {
  return [
    fields.recipientName,
    fields.addressLine1,
    fields.addressLine2,
    fields.city,
    fields.state,
    fields.zip,
    fields.fulfillmentMethodId,
    fields.greeting,
  ]
    .map(normalize)
    .join("|");
}

// Groups anything carrying the grouping fields (order lines, previews) by key.
export function groupByPackageKey<Line extends GroupingFields>(
  lines: Line[]
): Map<string, Line[]> {
  const groups = new Map<string, Line[]>();
  for (const line of lines) {
    const key = packageGroupingKey(line);
    const group = groups.get(key);
    if (group) group.push(line);
    else groups.set(key, [line]);
  }
  return groups;
}
