import { NextResponse } from "next/server";
import { issueSessionResponse, requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { canImpersonate, canTargetStaff } from "@/lib/permissions";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiPermission("staff.impersonate");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!canTargetStaff(gate.ctx.staff.id, id)) {
    return NextResponse.json({ error: "You cannot impersonate yourself" }, { status: 400 });
  }
  if (gate.ctx.impersonator) {
    return NextResponse.json({ error: "Stop the current impersonation first" }, { status: 400 });
  }

  const target = await prisma.staffUser.findUnique({ where: { id } });
  if (!target || target.status !== "ACTIVE") {
    return NextResponse.json({ error: "No active staff account for that id" }, { status: 404 });
  }
  // Impersonation may never raise privilege: target role rank must not
  // exceed the actor's (role check — a grantable override cannot escalate).
  if (!canImpersonate(gate.ctx.staff.role, target.role)) {
    return NextResponse.json(
      { error: "You cannot impersonate an account with a higher role than your own" },
      { status: 403 },
    );
  }

  await recordAudit({
    ctx: gate.ctx,
    action: "impersonation_start",
    targetType: "StaffUser",
    targetId: id,
    metadata: { targetEmail: target.email },
  });

  // The login session stays the actor's own: revoking it ends impersonation too.
  return issueSessionResponse(
    {
      staffUserId: target.id,
      impersonatorId: gate.ctx.staff.id,
      authSessionId: gate.ctx.session.authSessionId,
    },
    { ok: true },
  );
}
