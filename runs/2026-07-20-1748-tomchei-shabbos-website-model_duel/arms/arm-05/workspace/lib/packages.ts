export type PackageCandidate = {
  recipientKey: string;
  addressId: string | null;
  fulfillmentMethodId: string;
  greeting: string;
};

export function formatEnumLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function packageItemCount(lines: readonly { quantity: number }[]) {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

export function formatOrderLabel(order: { orderNumber: number | null; draftReference: string }) {
  return order.orderNumber === null ? order.draftReference : `#${order.orderNumber}`;
}

export function createPackageGroupingKey(candidate: PackageCandidate) {
  return JSON.stringify([
    candidate.recipientKey.trim().toLowerCase(),
    candidate.addressId,
    candidate.fulfillmentMethodId,
    candidate.greeting.trim(),
  ]);
}

export function groupPackageCandidates<T extends PackageCandidate>(candidates: readonly T[]) {
  const groups = new Map<string, T[]>();

  for (const candidate of candidates) {
    const key = createPackageGroupingKey(candidate);
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }

  return [...groups.entries()].map(([key, groupedCandidates]) => ({
    key,
    candidates: groupedCandidates,
  }));
}
