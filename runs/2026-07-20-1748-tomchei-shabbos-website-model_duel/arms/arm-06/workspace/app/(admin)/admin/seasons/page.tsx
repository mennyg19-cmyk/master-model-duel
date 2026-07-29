import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { listSeasonManagerRows } from "@/lib/seasons/queries";
import { SeasonManager } from "./season-manager";

export const metadata: Metadata = { title: "Seasons" };
export const dynamic = "force-dynamic";

// P10 (G-011/R-097/UR-008): season management — new-season wizard with
// optional catalog copy, the manager Open/Closed switch, and scheduled
// auto-flip (the season-flip cron consumes these timestamps, stored UTC).
export default async function SeasonsPage() {
  await requirePermission("catalog.manage");

  const seasons = await listSeasonManagerRows();

  return (
    <div>
      <h2 className="text-lg font-semibold text-stone-900">Seasons</h2>
      <p className="mt-1 text-sm text-stone-500">
        One season is open at a time — opening one closes the current one (that&apos;s the year flip). The archive
        stays browsable while a season is closed.
      </p>
      <SeasonManager
        seasons={seasons.map((season) => ({
          ...season,
          scheduledOpensAt: season.scheduledOpensAt?.toISOString() ?? null,
          scheduledClosesAt: season.scheduledClosesAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
