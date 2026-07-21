import { AuditAction } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canImpersonate, requireActorPermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { apiErrorResponse } from "@/lib/api-error";

const startSchema = z.object({
  targetStaffUserId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireActorPermission("staff.impersonate");
    const body = startSchema.parse(await request.json());
    if (body.targetStaffUserId === ctx.staff.id) {
      return NextResponse.json({ ok: false, error: "Cannot impersonate yourself" }, { status: 400 });
    }
    const target = await db.staffUser.findUnique({
      where: { id: body.targetStaffUserId },
      include: { permissionOverrides: true },
    });
    if (!target || !target.isActive || target.revokedAt) {
      return NextResponse.json({ ok: false, error: "Target staff not found or inactive" }, { status: 404 });
    }
    if (!canImpersonate(ctx.staff, target)) {
      return NextResponse.json(
        { ok: false, error: "Cannot impersonate a peer or higher-privileged staff member" },
        { status: 403 },
      );
    }

    await db.impersonationSession.updateMany({
      where: { impersonatorId: ctx.staff.id, active: true },
      data: { active: false, endedAt: new Date() },
    });

    const session = await db.impersonationSession.create({
      data: {
        impersonatorId: ctx.staff.id,
        impersonatedId: target.id,
        active: true,
      },
    });
    await writeAudit({
      action: AuditAction.IMPERSONATION_STARTED,
      actorId: ctx.staff.id,
      targetId: target.id,
      meta: {
        sessionId: session.id,
        actorRole: ctx.staff.role,
        targetRole: target.role,
      },
    });
    return NextResponse.json({ ok: true, sessionId: session.id });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    // Same gate as start, evaluated on the real actor (not the impersonated effective role).
    const ctx = await requireActorPermission("staff.impersonate");
    const active = await db.impersonationSession.findFirst({
      where: { impersonatorId: ctx.staff.id, active: true },
    });
    if (!active) {
      return NextResponse.json({ ok: true, ended: false });
    }
    await db.impersonationSession.update({
      where: { id: active.id },
      data: { active: false, endedAt: new Date() },
    });
    await writeAudit({
      action: AuditAction.IMPERSONATION_ENDED,
      actorId: ctx.staff.id,
      targetId: active.impersonatedId,
      meta: { sessionId: active.id, actorRole: ctx.staff.role },
    });
    return NextResponse.json({ ok: true, ended: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
