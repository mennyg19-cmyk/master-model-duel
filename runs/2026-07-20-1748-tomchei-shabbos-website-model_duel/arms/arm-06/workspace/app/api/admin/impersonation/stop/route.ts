import { NextResponse } from "next/server";
import { getAuthContext, issueSessionResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";

export async function POST() {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!ctx.session.impersonatorId) {
    return NextResponse.json({ error: "Not impersonating anyone" }, { status: 400 });
  }

  const impersonator = await prisma.staffUser.findUnique({
    where: { id: ctx.session.impersonatorId },
    include: { overrides: true },
  });
  if (!impersonator || impersonator.status !== "ACTIVE") {
    return NextResponse.json({ error: "Original account is no longer active" }, { status: 403 });
  }
  // The permission that authorized the impersonation must still hold at stop
  // time — a revoked override ends the session here, same gate as the start.
  if (!hasPermission({ role: impersonator.role, overrides: impersonator.overrides }, "staff.impersonate")) {
    return NextResponse.json({ error: "The impersonation permission no longer holds for the original account" }, { status: 403 });
  }

  await recordAudit({
    actor: { id: impersonator.id, email: impersonator.email },
    action: "impersonation_stop",
    targetType: "StaffUser",
    targetId: ctx.staff.id,
    metadata: { targetEmail: ctx.staff.email },
  });

  return issueSessionResponse(
    { staffUserId: impersonator.id, authSessionId: ctx.session.authSessionId },
    { ok: true },
  );
}
