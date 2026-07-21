import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { listReconcileRuns, runPaymentReconcile } from "@/lib/ops/reconcile";

export async function GET() {
  try {
    await requirePermission("settings.write");
    const runs = await listReconcileRuns(20);
    return NextResponse.json({ ok: true, runs });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const postSchema = z.object({
  action: z.enum(["run"]).default("run"),
});

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("settings.write");
    postSchema.parse(await request.json().catch(() => ({})));
    const result = await runPaymentReconcile({
      triggeredBy: "manual",
      staffId: staff.effectiveStaff.id,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
