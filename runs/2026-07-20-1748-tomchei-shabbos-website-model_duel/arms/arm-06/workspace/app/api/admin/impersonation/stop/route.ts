import { NextResponse } from "next/server";
import { getAuthContext, issueSessionResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";

export async function POST() {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!ctx.session.impersonatorId) {
    return NextResponse.json({ error: "Not impersonating anyone" }, { status: 400 });
  }

  const impersonator = await prisma.staffUser.findUnique({ where: { id: ctx.session.impersonatorId } });
  if (!impersonator || impersonator.status !== "ACTIVE") {
    return NextResponse.json({ error: "Original account is no longer active" }, { status: 403 });
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
