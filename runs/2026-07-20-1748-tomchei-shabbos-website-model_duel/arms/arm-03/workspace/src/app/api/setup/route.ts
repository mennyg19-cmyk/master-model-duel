import { AuditAction, StaffRole, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, getAuthIdentity, isSetupComplete } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { SETUP_LOCK_KEY } from "@/lib/constants";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";
import { apiErrorResponse } from "@/lib/api-error";

const bodySchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(80),
});

export async function GET() {
  try {
    const locked = await isSetupComplete();
    const managerCount = await db.staffUser.count({
      where: { role: StaffRole.MANAGER, isActive: true, revokedAt: null },
    });
    return NextResponse.json({ locked, managerCount });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await getAuthIdentity();
    if (!identity) {
      throw new AuthError(401, "Sign in required to bootstrap setup");
    }

    const json = await request.json();
    const body = bodySchema.parse(json);
    const email = normalizeEmail(body.email);

    const manager = await db.$transaction(async (tx) => {
      try {
        await tx.appSetting.create({
          data: {
            key: SETUP_LOCK_KEY,
            value: { reserving: true, at: new Date().toISOString() },
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AuthError(409, "Setup is locked — a manager already exists");
        }
        throw error;
      }

      const existingManager = await tx.staffUser.count({
        where: { role: StaffRole.MANAGER, isActive: true, revokedAt: null },
      });
      if (existingManager > 0) {
        throw new AuthError(409, "Setup is locked — a manager already exists");
      }

      const created = await tx.staffUser.create({
        data: {
          email,
          displayName: body.displayName,
          role: StaffRole.MANAGER,
          clerkUserId: identity.clerkUserId,
          confirmedAt: new Date(),
          isActive: true,
        },
      });

      await tx.appSetting.update({
        where: { key: SETUP_LOCK_KEY },
        data: {
          value: {
            complete: true,
            at: new Date().toISOString(),
            managerId: created.id,
          },
        },
      });

      return created;
    });

    await writeAudit({
      action: AuditAction.SETUP_BOOTSTRAP,
      actorId: manager.id,
      targetId: manager.id,
      meta: { email, clerkUserId: identity.clerkUserId },
    });

    return NextResponse.json({ ok: true, managerId: manager.id, locked: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
