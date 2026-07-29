import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { mapDomainError } from "@/lib/http-errors";
import { runNightlyPrintBatch } from "@/lib/packages/print-batches";

export const dynamic = "force-dynamic";

// UR-005/R-124: the nightly print batch, triggered by Vercel Cron (GET with
// an Authorization bearer). Every run — empty or not — leaves a CronRun row.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runNightlyPrintBatch();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
