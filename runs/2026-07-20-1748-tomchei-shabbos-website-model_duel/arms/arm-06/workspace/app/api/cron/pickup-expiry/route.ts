import { NextResponse } from "next/server";
import { sweepPickupExpiry } from "@/lib/pickup/readiness";
import { getOpenSeason } from "@/lib/seasons/queries";
import { cronRoute } from "@/lib/cron-route";

// G-017/G-026/R-182: the pickup sweep, Vercel Cron (GET + Authorization
// bearer). Readiness sync first (a restock flips eligibility in the same
// run), then the expiry pass; every run leaves a CronRun row.
export const dynamic = "force-dynamic";

export const GET = cronRoute(async () => {
  const season = await getOpenSeason();
  if (!season) return NextResponse.json({ error: "No open season" }, { status: 422 });
  return sweepPickupExpiry(season.id);
});
