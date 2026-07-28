import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { canTargetStaff } from "@/lib/permissions";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiPermission("staff.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!canTargetStaff(gate.ctx.staff.id, id)) {
    return NextResponse.json({ error: "You cannot revoke your own account" }, { status: 400 });
  }

  const target = await prisma.staffUser.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "Staff account not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.staffUser.update({
      where: { id },
      data: { status: "REVOKED", version: { increment: 1 } },
    }),
    // Server-side session revocation: existing cookies die immediately.
    prisma.authSession.updateMany({
      where: { staffUserId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  await recordAudit({
    ctx: gate.ctx,
    action: "staff_revoke",
    targetType: "StaffUser",
    targetId: id,
    metadata: { email: target.email },
  });
  return NextResponse.json({ ok: true });
}
