import { NextResponse } from "next/server";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";

export async function GET() {
  try {
    const staffSession = await requirePermission("admin:view");
    const canViewAudit = hasPermission(staffSession.effective, "audit:view");
    const [staffCount, recentAudit] = await Promise.all([
      db.staffUser.count(),
      canViewAudit
        ? db.auditLog.findMany({
            orderBy: { occurredAt: "desc" },
            take: 12,
          })
        : Promise.resolve([]),
    ]);
    return NextResponse.json({
      currentRole: staffSession.effective.role,
      isImpersonating: staffSession.actor.id !== staffSession.effective.id,
      staffCount,
      recentAudit,
    });
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
