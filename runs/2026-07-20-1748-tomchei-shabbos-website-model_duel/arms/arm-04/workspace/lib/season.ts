import { db } from "@/lib/db";

/**
 * The storefront sells from the single OPEN season (UR-008). opensAt/closesAt
 * scheduled flips are a cron job's write; reads only trust status, so an
 * admin toggle takes effect on the next request.
 */
export async function getOpenSeason() {
  return db.season.findFirst({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } });
}

/** Past collections for the browse-only archive (R-005): every non-open season with products. */
export async function getArchiveSeasons() {
  return db.season.findMany({
    where: { status: "CLOSED", products: { some: {} } },
    orderBy: { createdAt: "desc" },
  });
}
