import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { mapDomainError } from "@/lib/http-errors";
import { sweepPickupExpiry } from "@/lib/pickup/readiness";
import { getOpenSeason } from "@/lib/seasons/queries";

export const dynamic = "force-dynamic";

// G-017/G-026/R-182: the pickup sweep, Vercel Cron (GET + Authorization
// bearer). Readiness sync first (a restock flips eligibility in the same
// run), then the expiry pass; every run leaves a CronRun row.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const season = await getOpenSeason();
  if (!season) return NextResponse.json({ error: "No open season" }, { status: 422 });

  try {
    const result = await sweepPickupExpiry(season.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
