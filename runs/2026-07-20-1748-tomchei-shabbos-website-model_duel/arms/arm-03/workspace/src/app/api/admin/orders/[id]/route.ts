import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getOrderDetail } from "@/lib/ops/orders";
import { db } from "@/lib/db";
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
];

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requirePermission("admin.access");
    const { id } = await ctx.params;
    const order = await getOrderDetail(id);
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const recent = await db.auditLog.findMany({
      where: { action: { in: ORDER_AUDIT_ACTIONS } },
      orderBy: { createdAt: "desc" },
      take: 250,
      include: { actor: { select: { displayName: true } } },
    });
    const audits = recent
      .filter((row) => {
        const meta = row.meta as { orderId?: string; created?: Array<{ sourceOrderId?: string }> } | null;
        if (!meta) return false;
        if (meta.orderId === id) return true;
        if (Array.isArray(meta.created) && meta.created.some((c) => c.sourceOrderId === id)) {
          return true;
        }
        return false;
      })
      .slice(0, 40);
    return NextResponse.json({ ok: true, order, audits });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
