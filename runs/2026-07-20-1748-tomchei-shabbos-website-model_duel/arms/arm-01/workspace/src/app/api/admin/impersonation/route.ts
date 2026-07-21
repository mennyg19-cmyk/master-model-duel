import { NextResponse } from "next/server";
import {
  AccessDeniedError,
  getCurrentStaffUser,
  requirePermission,
} from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const staffSession = await requirePermission("staff:impersonate");
    const body = (await request.json()) as { targetStaffId?: string };
    if (!body.targetStaffId || body.targetStaffId === staffSession.actor.id) {
      return NextResponse.json(
        { error: "Choose another active staff user to impersonate." },
        { status: 400 },
      );
    }

    const target = await db.staffUser.findUnique({
      where: { id: body.targetStaffId },
    });
    if (!target || target.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "The target staff account must be active." },
        { status: 409 },
      );
    }

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const [impersonationSession] = await db.$transaction([
      db.impersonationSession.create({
        data: {
          actorStaffId: staffSession.actor.id,
          targetStaffId: target.id,
          expiresAt,
        },
      }),
      db.auditLog.create({
        data: {
          actorStaffId: staffSession.actor.id,
          action: "staff.impersonation_started",
          targetType: "StaffUser",
          targetId: target.id,
          impersonatorId: staffSession.actor.id,
        },
      }),
    ]);

    const response = NextResponse.json({
      impersonating: target.displayName,
    });
    response.cookies.set("impersonation_session_id", impersonationSession.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: expiresAt,
    });
    return response;
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}

export async function DELETE() {
  try {
    const staffSession = await getCurrentStaffUser();
    if (!staffSession || staffSession.actor.id === staffSession.effective.id) {
      throw new AccessDeniedError("No active impersonation session was found.");
    }

    const endedAt = new Date();
    await db.$transaction(async (transaction) => {
      await transaction.impersonationSession.updateMany({
        where: {
          actorStaffId: staffSession.actor.id,
          targetStaffId: staffSession.effective.id,
          endedAt: null,
        },
        data: { endedAt },
      });
      await transaction.auditLog.create({
        data: {
          actorStaffId: staffSession.actor.id,
          action: "staff.impersonation_ended",
          targetType: "StaffUser",
          targetId: staffSession.effective.id,
          impersonatorId: staffSession.actor.id,
          metadata: { endedAt: endedAt.toISOString() },
        },
      });
    });

    const response = NextResponse.json({ impersonating: null });
    response.cookies.set("impersonation_session_id", "", {
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
