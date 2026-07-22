import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { runCronJob } from "@/lib/cron";
import { runPaymentReconciliation } from "@/lib/payments/reconcile";

// Stripe payment reconciliation (R-093): run button + open-flag list + resolve.

export async function GET() {
  const gate = await requirePermissionApi("reports.view");
  if ("response" in gate) return gate.response;

  const flags = await db.paymentReconFlag.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return Response.json({ flags });
}

export async function POST() {
  const gate = await requirePermissionApi("reports.view");
  if ("response" in gate) return gate.response;

  // Same overlap lock as the nightly cron — concurrent manual POSTs (and
  // manual+cron) skip instead of racing creates on unique `reference`.
  const summary = await runCronJob("stripe-reconciliation", () => runPaymentReconciliation());
  if ("skipped" in summary) {
    return Response.json({ error: "Reconciliation already running — try again in a moment" }, { status: 409 });
  }
  await writeAudit(gate.staff, {
    action: "reconciliation.run",
    targetType: "PaymentReconFlag",
    detail: summary as unknown as Record<string, number>,
  });
  return Response.json({ ok: true, summary });
}

const resolveSchema = z.object({ flagId: z.string().min(1), note: z.string().max(500).optional() });

export async function PATCH(request: Request) {
  const gate = await requirePermissionApi("reports.view");
  if ("response" in gate) return gate.response;

  const parsed = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "flagId is required" }, { status: 400 });

  const updated = await db.paymentReconFlag.updateMany({
    where: { id: parsed.data.flagId, status: "open" },
    data: { status: "resolved", resolvedAt: new Date(), resolvedByStaffId: gate.staff.realUser.id },
  });
  if (updated.count === 0) {
    return Response.json({ error: "Flag not found or already resolved" }, { status: 404 });
  }
  await writeAudit(gate.staff, {
    action: "reconciliation.resolve",
    targetType: "PaymentReconFlag",
    targetId: parsed.data.flagId,
    detail: { note: parsed.data.note ?? null },
  });
  return Response.json({ ok: true });
}
