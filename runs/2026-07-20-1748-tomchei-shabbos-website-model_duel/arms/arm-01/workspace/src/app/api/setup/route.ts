import { Prisma, StaffRole, StaffStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAuthenticatedClerkUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";

const bootstrapKey = "first-manager";

export async function GET() {
  const bootstrap = await db.bootstrapState.findUnique({
    where: { key: bootstrapKey },
  });
  return NextResponse.json({ locked: Boolean(bootstrap) });
}

export async function POST(request: Request) {
  const clerkUserId = await getAuthenticatedClerkUserId();
  if (!clerkUserId) {
    return NextResponse.json(
      { error: "A Clerk user identity is required to bootstrap the first manager." },
      { status: 401 },
    );
  }

  const body = (await request.json()) as {
    email?: string;
    displayName?: string;
    setupToken?: string;
  };
  const { email, displayName } = body;
  if (!process.env.SETUP_TOKEN || body.setupToken !== process.env.SETUP_TOKEN) {
    return NextResponse.json(
      { error: "A valid setup token is required." },
      { status: 403 },
    );
  }
  if (!email || !displayName) {
    return NextResponse.json(
      { error: "Email and display name are required." },
      { status: 400 },
    );
  }

  try {
    const manager = await db.$transaction(async (transaction) => {
      const isLocked = await transaction.bootstrapState.findUnique({
        where: { key: bootstrapKey },
      });
      if (isLocked) {
        throw new Error("BOOTSTRAP_LOCKED");
      }

      const createdManager = await transaction.staffUser.create({
        data: {
          clerkUserId,
          email: normalizeEmail(email),
          displayName: displayName.trim(),
          role: StaffRole.MANAGER,
          status: StaffStatus.ACTIVE,
          confirmedAt: new Date(),
        },
      });
      await transaction.bootstrapState.create({
        data: {
          key: bootstrapKey,
          managerStaffId: createdManager.id,
          managerClerkId: clerkUserId,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorStaffId: createdManager.id,
          action: "staff.bootstrap_manager",
          targetType: "StaffUser",
          targetId: createdManager.id,
        },
      });
      return createdManager;
    });

    return NextResponse.json(
      { id: manager.id, role: manager.role, locked: true },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "BOOTSTRAP_LOCKED") {
      return NextResponse.json(
        { error: "Setup is locked because the first manager already exists." },
        { status: 409 },
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "That Clerk identity or email already belongs to a staff account." },
        { status: 409 },
      );
    }
    throw error;
  }
}
