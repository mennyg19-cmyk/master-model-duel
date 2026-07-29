import { NextResponse } from "next/server";
import { FulfillmentChoice } from "@prisma/client";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { reprintBatch } from "@/lib/packages/print-batches";

export const dynamic = "force-dynamic";

// filingGroup is constrained to the channel enum: it is persisted verbatim on
// PrintBatch and interpolated into the PDF Content-Disposition filename.
const reprintSchema = z
  .object({
    filingGroup: z.enum(FulfillmentChoice).optional(),
    orderId: z.string().min(1).optional(),
  })
  .refine((value) => (value.filingGroup ? 1 : 0) + (value.orderId ? 1 : 0) === 1, {
    message: "exactly one scope",
  });

// UR-005: reprint one filing group or one order. The new batch supersedes the
// predecessor and never regenerates unrelated groups.
export async function POST(request: Request) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, reprintSchema, "Exactly one scope is required: filingGroup or orderId");
  if (!parsed.ok) return parsed.response;

  try {
    const batch = await reprintBatch({ ...parsed.data, createdById: gate.ctx.staff.id });
    await recordAudit({
      ctx: gate.ctx,
      action: "print_batch_reprint",
      targetType: "PrintBatch",
      targetId: batch.id,
      metadata: {
        filingGroup: batch.filingGroup,
        trigger: batch.trigger,
        packageCount: batch.packageCount,
        supersedesId: batch.supersedesId,
        scope: parsed.data,
      },
    });
    return NextResponse.json({
      ok: true,
      batch: { id: batch.id, filingGroup: batch.filingGroup, packageCount: batch.packageCount, supersedesId: batch.supersedesId },
    });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
