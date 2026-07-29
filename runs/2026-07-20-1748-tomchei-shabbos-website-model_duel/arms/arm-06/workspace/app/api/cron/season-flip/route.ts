import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { mapDomainError } from "@/lib/http-errors";
import { runSeasonFlip } from "@/lib/seasons/manage";

export const dynamic = "force-dynamic";

// P10 (R-041/UR-008): scheduled season auto-flip, Vercel Cron (GET +
// Authorization bearer, same as the other crons). Every run leaves a
// CronRun row inside runSeasonFlip.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runSeasonFlip();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
