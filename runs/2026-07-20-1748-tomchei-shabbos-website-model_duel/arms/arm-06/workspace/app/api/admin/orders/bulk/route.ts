import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { BULK_ACTION_LIMIT, runBulkOrderAction } from "@/lib/orders/bulk";

export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  action: z.enum(["repeat", "discard"]),
  orderIds: z.array(z.string().min(1)).min(1).max(BULK_ACTION_LIMIT),
});

// G-024: bounded bulk actions with a deterministic per-row report — the same
// batch always produces the same outcomes. The audit row records the full
// per-order report (not just counts), so which orders were affected and why
// is always reconstructable; each discard also lands its own order_discard
// row inside the discard transaction.
export async function POST(request: Request) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, bulkSchema, "An action and order ids are required");
  if (!parsed.ok) return parsed.response;

  try {
    const report = await runBulkOrderAction({ ...parsed.data, ctx: gate.ctx });
    await recordAudit({
      ctx: gate.ctx,
      action: "bulk_action",
      targetType: "Order",
      metadata: {
        action: report.action,
        requested: parsed.data.orderIds.length,
        succeeded: report.counts.succeeded,
        skipped: report.counts.skipped,
        results: report.results as unknown as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
