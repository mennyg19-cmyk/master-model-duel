import { createHash } from "node:crypto";
import { StaffRole, StaffStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { AccessDeniedError, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { createSecureToken } from "@/lib/ids";
import { normalizeEmail } from "@/lib/normalize";

function permissionError(error: unknown) {
  if (error instanceof AccessDeniedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  throw error;
}

export async function GET() {
  try {
    await requirePermission("staff:manage");
    const staffUsers = await db.staffUser.findMany({
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        grantPermissions: true,
        denyPermissions: true,
        version: true,
      },
    });
    return NextResponse.json({ staffUsers });
  } catch (error) {
    return permissionError(error);
  }
}

export async function POST(request: Request) {
  try {
    const staffSession = await requirePermission("staff:manage");
    const body = (await request.json()) as {
      email?: string;
      displayName?: string;
      role?: StaffRole;
    };
    const { email, displayName, role } = body;
    if (!email || !displayName || !role) {
      return NextResponse.json(
        { error: "Email, display name, and role are required." },
        { status: 400 },
      );
    }

    const inviteToken = createSecureToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const staffUser = await db.$transaction(async (transaction) => {
      const createdStaffUser = await transaction.staffUser.create({
        data: {
          email: normalizeEmail(email),
          displayName: displayName.trim(),
          role,
        },
      });
      await transaction.staffInvite.create({
        data: {
          tokenHash: createHash("sha256").update(inviteToken).digest("hex"),
          email: createdStaffUser.email,
          role: createdStaffUser.role,
          expiresAt,
          invitedById: staffSession.actor.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorStaffId: staffSession.actor.id,
          action: "staff.invited",
          targetType: "StaffUser",
          targetId: createdStaffUser.id,
          impersonatorId:
            staffSession.actor.id === staffSession.effective.id
              ? null
              : staffSession.actor.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorStaffId: staffSession.actor.id,
          action: "staff.invitation_token_revealed",
          targetType: "StaffUser",
          targetId: createdStaffUser.id,
          metadata: { expiresAt: expiresAt.toISOString() },
          impersonatorId:
            staffSession.actor.id === staffSession.effective.id
              ? null
              : staffSession.actor.id,
        },
      });
      return createdStaffUser;
    });

    return NextResponse.json(
      { staffUser, inviteToken, expiresAt },
      { status: 201 },
    );
  } catch (error) {
    return permissionError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const staffSession = await requirePermission("staff:manage");
    const body = (await request.json()) as {
      id?: string;
      version?: number;
      role?: StaffRole;
      status?: StaffStatus;
      grantPermissions?: string[];
      denyPermissions?: string[];
    };
    if (!body.id || !body.version) {
      return NextResponse.json(
        { error: "Staff ID and version are required." },
        { status: 400 },
      );
    }
    const staffId = body.id;
    const expectedVersion = body.version;
    if (
      (staffId === staffSession.actor.id ||
        staffId === staffSession.effective.id) &&
      (body.role !== undefined ||
        body.status !== undefined ||
        body.grantPermissions !== undefined ||
        body.denyPermissions !== undefined)
    ) {
      return NextResponse.json(
        { error: "Managers cannot change their own role, status, or permission overrides." },
        { status: 409 },
      );
    }

    const updated = await db.$transaction(async (transaction) => {
      const updateCount = await transaction.staffUser.updateMany({
        where: { id: staffId, version: expectedVersion },
        data: {
          role: body.role,
          status: body.status,
          grantPermissions: body.grantPermissions,
          denyPermissions: body.denyPermissions,
          revokedAt:
            body.status === StaffStatus.REVOKED ? new Date() : undefined,
          version: { increment: 1 },
        },
      });
      if (updateCount.count !== 1) {
        return null;
      }
      await transaction.auditLog.create({
        data: {
          actorStaffId: staffSession.actor.id,
          action:
            body.status === StaffStatus.REVOKED
              ? "staff.revoked"
              : "staff.permissions_or_role_changed",
          targetType: "StaffUser",
          targetId: staffId,
          metadata: { previousVersion: expectedVersion },
        },
      });
      return transaction.staffUser.findUnique({ where: { id: staffId } });
    });

    if (!updated) {
      return NextResponse.json(
        { error: "This staff record changed. Reload before saving again." },
        { status: 409 },
      );
    }
    return NextResponse.json({ staffUser: updated });
  } catch (error) {
    return permissionError(error);
  }
}
