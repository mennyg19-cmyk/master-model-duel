import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createNightlyPrintBatch,
  reprintFilingGroup,
  reprintOrder,
} from "@/domain/print-batches";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

const printActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("nightly"),
    dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    action: z.literal("reprint-group"),
    filingGroup: z.string().trim().min(1).max(80),
  }),
  z.object({
    action: z.literal("reprint-order"),
    orderId: z.string().min(1),
  }),
]);

export async function POST(request: Request) {
  try {
    const session = await requirePermission("orders:manage");
    const parsed = printActionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Print batch action details are invalid." },
        { status: 400 },
      );
    }
    const input = parsed.data;
    if (input.action === "nightly") {
      return NextResponse.json(
        await createNightlyPrintBatch(db, input.dateKey, session.actor.id),
      );
    }
    const batch =
      input.action === "reprint-group"
        ? await reprintFilingGroup(db, input.filingGroup, session.actor.id)
        : await reprintOrder(db, input.orderId, session.actor.id);
    return NextResponse.json({ batch, replayed: false });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Print batch failed." },
      { status: 409 },
    );
  }
}
