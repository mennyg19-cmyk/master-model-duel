import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { createLoginSession, issueSessionResponse } from "@/lib/auth";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const staff = await prisma.staffUser.findUnique({ where: { inviteToken: token } });
  if (!staff || staff.status !== "PENDING") {
    return NextResponse.json({ error: "Invite is invalid or already used" }, { status: 404 });
  }
  if (!staff.invitedAt || Date.now() - staff.invitedAt.getTime() > INVITE_TTL_MS) {
    return NextResponse.json({ error: "Invite has expired. Ask a manager for a fresh one." }, { status: 410 });
  }

  const confirmed = await prisma.staffUser.update({
    where: { id: staff.id },
    data: { status: "ACTIVE", confirmedAt: new Date(), inviteToken: null, version: { increment: 1 } },
  });
  await recordAudit({
    actor: { id: confirmed.id, email: confirmed.email },
    action: "staff_confirm",
    targetType: "StaffUser",
    targetId: confirmed.id,
  });

  const authSession = await createLoginSession(confirmed.id);
  const destination = confirmed.role === "DRIVER" ? "/driver" : "/admin";
  return issueSessionResponse(
    { staffUserId: confirmed.id, authSessionId: authSession.id },
    { ok: true, next: destination },
  );
}
