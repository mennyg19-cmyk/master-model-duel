import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getOrderDetail } from "@/lib/ops/orders";
import { listAudit } from "@/lib/audit";
import { AuditAction } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const ORDER_AUDIT_ACTIONS: AuditAction[] = [
  AuditAction.PAYMENT_POSTED,
  AuditAction.PAYMENT_VOIDED,
  AuditAction.PAYMENT_REFUNDED,
  AuditAction.ORDER_PAID,
  AuditAction.ORDER_FINALIZED,
  AuditAction.ORDER_REPEATED,
  AuditAction.CHECKOUT_STARTED,
  AuditAction.BULK_ACTION_APPLIED,
  AuditAction.LABEL_PURCHASED,
  AuditAction.LABEL_VOIDED,
  AuditAction.LABEL_FAILED,
  AuditAction.TRACKING_REFRESHED,
];

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requirePermission("admin.access");
    const { id } = await ctx.params;
    const order = await getOrderDetail(id);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const audits = await listAudit({
      orderId: id,
      limit: 40,
      actions: ORDER_AUDIT_ACTIONS,
    });
    return NextResponse.json({ ok: true, order, audits });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
