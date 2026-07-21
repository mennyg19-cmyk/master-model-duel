import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { requireCronBearer } from "@/lib/cron/auth";
import { beginCronRun, finishCronRun } from "@/lib/cron/runs";
import { purgeEmailLogs } from "@/lib/email/purge";

async function runPurgeEmailLog(request: Request) {
  requireCronBearer(request);
  const url = new URL(request.url);
  const claimedToken = url.searchParams.get("token") || undefined;
  const claim = await beginCronRun("purge-email-log", claimedToken);
  if (!claim.claimed) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "overlap",
      token: claim.token,
    });
  }

  try {
    const purgeResult = await purgeEmailLogs();
    await finishCronRun(claim.run.id, { ok: true, meta: purgeResult });
    return NextResponse.json({
      ok: true,
      skipped: false,
      ...purgeResult,
      runId: claim.run.id,
    });
  } catch (error) {
    await finishCronRun(claim.run.id, {
      ok: false,
      meta: {
        error: error instanceof Error ? error.message : "purge-email-log failed",
      },
    });
    throw error;
  }
}

/** Vercel Cron invokes GET; smoke/manual use POST. */
export async function GET(request: Request) {
  try {
    return await runPurgeEmailLog(request);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return await runPurgeEmailLog(request);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
