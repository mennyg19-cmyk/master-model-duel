import { SeasonStatus, type Season } from "@prisma/client";
import { db } from "@/lib/db";

export async function getCurrentSeason(): Promise<Season | null> {
  const open = await db.season.findFirst({
    where: { status: SeasonStatus.OPEN },
    orderBy: { year: "desc" },
  });
  if (open) return open;
  return db.season.findFirst({ orderBy: { year: "desc" } });
}

export function isStoreOpen(season: Pick<Season, "status"> | null | undefined): boolean {
  return season?.status === SeasonStatus.OPEN;
}

export async function listArchiveSeasons(): Promise<Season[]> {
  return db.season.findMany({
    where: { status: SeasonStatus.CLOSED },
    orderBy: [{ year: "desc" }, { name: "asc" }],
  });
}

export async function getSeasonBySlug(slug: string): Promise<Season | null> {
  return db.season.findUnique({ where: { slug } });
}
