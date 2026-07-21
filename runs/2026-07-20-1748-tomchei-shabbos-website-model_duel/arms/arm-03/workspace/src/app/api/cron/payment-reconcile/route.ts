import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { requireCronBearer } from "@/lib/cron/auth";
import { beginCronRun, finishCronRun } from "@/lib/cron/runs";
import { runPaymentReconcile } from "@/lib/ops/reconcile";

async function runReconcileCron(request: Request) {
  requireCronBearer(request);
  const url = new URL(request.url);
  const claimedToken = url.searchParams.get("token") || undefined;
  const claim = await beginCronRun("payment-reconcile", claimedToken);
  if (!claim.claimed) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "overlap",
      token: claim.token,
    });
  }

  try {
    const result = await runPaymentReconcile({ triggeredBy: "cron" });
    const ok = result.ok;
    await finishCronRun(claim.run.id, {
      ok,
      meta: result.ok ? result.value : { error: result.publicMessage },
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.publicMessage, runId: claim.run.id },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      skipped: false,
      ...result.value,
      cronRunId: claim.run.id,
    });
  } catch (error) {
    await finishCronRun(claim.run.id, {
      ok: false,
      meta: {
        error: error instanceof Error ? error.message : "payment-reconcile failed",
      },
    });
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    return await runReconcileCron(request);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return await runReconcileCron(request);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
