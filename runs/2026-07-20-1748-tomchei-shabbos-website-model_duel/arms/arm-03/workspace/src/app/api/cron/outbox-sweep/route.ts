import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { apiErrorResponse } from "@/lib/api-error";
import { requireCronBearer } from "@/lib/cron/auth";
import { beginCronRun, finishCronRun } from "@/lib/cron/runs";
import { sweepOutbox } from "@/lib/notify/outbox";

async function runOutboxSweep(request: Request) {
  requireCronBearer(request);
  const url = new URL(request.url);
  const claimedToken = url.searchParams.get("token") || undefined;
  const claim = await beginCronRun("outbox-sweep", claimedToken);
  if (!claim.claimed) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "overlap",
      token: claim.token,
    });
  }

  try {
    const workerId = `cron_${claim.run.id}_${randomBytes(3).toString("hex")}`;
    const sweepResult = await sweepOutbox({ workerId, limit: 40 });
    const ok = sweepResult.failed === 0;
    await finishCronRun(claim.run.id, { ok, meta: sweepResult });
    return NextResponse.json({ ok, skipped: false, ...sweepResult, runId: claim.run.id });
  } catch (error) {
    await finishCronRun(claim.run.id, {
      ok: false,
      meta: {
        error: error instanceof Error ? error.message : "outbox-sweep failed",
      },
    });
    throw error;
  }
}

/** Vercel Cron invokes GET; smoke/manual use POST. */
export async function GET(request: Request) {
  try {
    return await runOutboxSweep(request);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return await runOutboxSweep(request);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
