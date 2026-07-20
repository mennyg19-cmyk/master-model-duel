import { createHash } from "node:crypto";
import { StaffStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAuthenticatedClerkUserId } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const clerkUserId = await getAuthenticatedClerkUserId();
  const body = (await request.json()) as { token?: string };
  if (!clerkUserId) {
    return NextResponse.json(
      { error: "An authenticated Clerk identity is required." },
      { status: 401 },
    );
  }
  if (!body.token) {
    return NextResponse.json(
      { error: "An invitation token is required." },
      { status: 400 },
    );
  }

  const tokenHash = createHash("sha256").update(body.token).digest("hex");
  const invitation = await db.staffInvite.findUnique({
    where: { tokenHash },
  });
  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.expiresAt <= new Date()
  ) {
    return NextResponse.json(
      { error: "The invitation is invalid, expired, or already used." },
      { status: 409 },
    );
  }

  const staffUser = await db.$transaction(async (transaction) => {
    const linkedStaffUser = await transaction.staffUser.update({
      where: { email: invitation.email },
      data: {
        clerkUserId,
        status: StaffStatus.ACTIVE,
        confirmedAt: new Date(),
      },
    });
    await transaction.staffInvite.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });
    await transaction.auditLog.create({
      data: {
        actorStaffId: linkedStaffUser.id,
        action: "staff.invitation_accepted",
        targetType: "StaffUser",
        targetId: linkedStaffUser.id,
      },
    });
    return linkedStaffUser;
  });

  return NextResponse.json({
    id: staffUser.id,
    role: staffUser.role,
    status: staffUser.status,
  });
}
