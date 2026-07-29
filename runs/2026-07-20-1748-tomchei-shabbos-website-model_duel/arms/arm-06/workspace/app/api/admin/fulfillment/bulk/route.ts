import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PackageStage } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { BULK_ACTION_LIMIT } from "@/lib/orders/bulk";
import { runBulkPackageAdvance } from "@/lib/packages/bulk";

export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  packageIds: z.array(z.string().min(1)).min(1).max(BULK_ACTION_LIMIT),
  to: z.enum(PackageStage),
});

// R-072: bulk status actions from the fulfillment dashboard — same
// bounded/deterministic discipline as order bulk actions; the audit row
// records the full per-package report.
export async function POST(request: Request) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, bulkSchema, "Package ids and a target stage are required");
  if (!parsed.ok) return parsed.response;

  try {
    const report = await runBulkPackageAdvance({ ...parsed.data, ctx: gate.ctx });
    await recordAudit({
      ctx: gate.ctx,
      action: "bulk_action",
      targetType: "Package",
      metadata: {
        action: "package_advance",
        to: report.to,
        requested: parsed.data.packageIds.length,
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
