import { Prisma } from "@prisma/client";

// P12 (R-186): the "Legacy <year>" season convention, shared with the P10
// repeat hook (lib/repeat/import-hook.ts). Historical rows never land in the
// open season — they live in a CLOSED per-year season so reports can roll
// them up and repeat-order can read them, without polluting the live catalog.
export function legacySeasonName(year: number): string {
  return `Legacy ${year}`;
}

export async function legacySeason(tx: Prisma.TransactionClient, year: number) {
  return tx.season.upsert({
    where: { name: legacySeasonName(year) },
    update: {},
    create: { name: legacySeasonName(year), status: "CLOSED" },
  });
}
