export type PackageCandidate = {
  recipientKey: string;
  addressId: string | null;
  fulfillmentMethodId: string;
  greeting: string;
};

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
