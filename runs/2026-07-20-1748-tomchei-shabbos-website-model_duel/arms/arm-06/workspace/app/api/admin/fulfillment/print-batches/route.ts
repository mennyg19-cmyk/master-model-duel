import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { mapDomainError } from "@/lib/http-errors";
import { runNightlyPrintBatch } from "@/lib/packages/print-batches";

export const dynamic = "force-dynamic";

// UR-005: staff "run the batch now" — the same engine the nightly cron hits.
// Idempotent by construction: only unclaimed packages file, so a second run
// creates zero batches.
export async function POST() {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;

  try {
    const result = await runNightlyPrintBatch({ createdById: gate.ctx.staff.id });
    await recordAudit({
      ctx: gate.ctx,
      action: "print_batch_run",
      targetType: "PrintBatch",
      metadata: {
        batches: result.batches as unknown as Prisma.InputJsonValue,
        packageCount: result.packageCount,
        cronRunId: result.cronRunId,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
