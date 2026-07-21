/** Draft wire format: D-{seasonYear}-{cuidSuffix} */

export function formatDraftRef(seasonYear: number, uniqueSuffix: string): string {
  const suffix = uniqueSuffix.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
  return `D-${seasonYear}-${suffix}`;
}

export function parseDraftRef(
  draftRef: string,
): { seasonYear: number; suffix: string } | null {
  const match = /^D-(\d{4})-([A-Z0-9]+)$/i.exec(draftRef.trim());
  if (!match) return null;
  return { seasonYear: Number(match[1]), suffix: match[2].toUpperCase() };
}
