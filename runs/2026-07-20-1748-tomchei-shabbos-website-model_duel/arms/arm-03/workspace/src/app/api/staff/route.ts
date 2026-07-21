import { AuditAction, PermissionEffect, StaffRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";
import { PERMISSIONS } from "@/lib/permissions";
import { apiErrorResponse } from "@/lib/api-error";

const createSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(80),
  role: z.nativeEnum(StaffRole),
});

const roleSchema = z.object({
  staffUserId: z.string().min(1),
  role: z.nativeEnum(StaffRole),
  expectedVersion: z.number().int().positive(),
});

const overrideSchema = z.object({
  staffUserId: z.string().min(1),
  permission: z.enum(PERMISSIONS as unknown as [string, ...string[]]),
  effect: z.nativeEnum(PermissionEffect).nullable(),
});

const revokeSchema = z.object({
  staffUserId: z.string().min(1),
});

export async function GET() {
  try {
    await requirePermission("staff.manage");
    const staff = await db.staffUser.findMany({
      include: { permissionOverrides: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ ok: true, staff });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("staff.manage");
    const body = createSchema.parse(await request.json());
    const email = normalizeEmail(body.email);

    const customer = await db.customer.findUnique({ where: { email } });
    if (customer) {
      return NextResponse.json(
        { ok: false, error: "Email belongs to a customer account" },
        { status: 409 },
      );
    }

    const created = await db.staffUser.create({
      data: {
        email,
        displayName: body.displayName,
        role: body.role,
        isActive: true,
      },
    });
    await writeAudit({
      action: AuditAction.STAFF_CREATED,
      actorId: ctx.staff.id,
      targetId: created.id,
      meta: { email, role: body.role },
    });
    return NextResponse.json({ ok: true, staff: created });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requirePermission("staff.manage");
    const json = await request.json();
    const intent = z.object({ intent: z.enum(["role", "override", "revoke", "confirm"]) }).parse(json);

    if (intent.intent === "role") {
      const body = roleSchema.parse(json);
      if (body.staffUserId === ctx.staff.id) {
        return NextResponse.json({ ok: false, error: "Cannot change your own role" }, { status: 400 });
      }
      const existing = await db.staffUser.findUnique({ where: { id: body.staffUserId } });
      if (!existing) {
        return NextResponse.json({ ok: false, error: "Staff not found" }, { status: 404 });
      }
      if (existing.version !== body.expectedVersion) {
        return NextResponse.json(
          {
            ok: false,
            error: `version conflict: expected ${body.expectedVersion}, found ${existing.version}`,
            conflict: true,
          },
          { status: 409 },
        );
      }
      const updated = await db.staffUser.update({
        where: { id: body.staffUserId },
        data: { role: body.role, version: { increment: 1 } },
      });
      await writeAudit({
        action: AuditAction.STAFF_ROLE_CHANGED,
        actorId: ctx.staff.id,
        targetId: updated.id,
        meta: { from: existing.role, to: body.role, version: updated.version },
      });
      return NextResponse.json({ ok: true, staff: updated });
    }

    if (intent.intent === "override") {
      const body = overrideSchema.parse(json);
      if (body.staffUserId === ctx.staff.id) {
        return NextResponse.json(
          { ok: false, error: "Cannot edit your own permission overrides" },
          { status: 400 },
        );
      }
      if (body.effect === null) {
        await db.permissionOverride.deleteMany({
          where: { staffUserId: body.staffUserId, permission: body.permission },
        });
      } else {
        await db.permissionOverride.upsert({
          where: {
            staffUserId_permission: {
              staffUserId: body.staffUserId,
              permission: body.permission,
            },
          },
          create: {
            staffUserId: body.staffUserId,
            permission: body.permission,
            effect: body.effect,
          },
          update: { effect: body.effect },
        });
      }
      await writeAudit({
        action: AuditAction.STAFF_PERMISSION_CHANGED,
        actorId: ctx.staff.id,
        targetId: body.staffUserId,
        meta: { permission: body.permission, effect: body.effect },
      });
      return NextResponse.json({ ok: true });
    }

    if (intent.intent === "revoke") {
      const body = revokeSchema.parse(json);
      if (body.staffUserId === ctx.staff.id) {
        return NextResponse.json({ ok: false, error: "Cannot revoke yourself" }, { status: 400 });
      }
      const updated = await db.staffUser.update({
        where: { id: body.staffUserId },
        data: { isActive: false, revokedAt: new Date(), version: { increment: 1 } },
      });
      await writeAudit({
        action: AuditAction.STAFF_REVOKED,
        actorId: ctx.staff.id,
        targetId: updated.id,
      });
      return NextResponse.json({ ok: true, staff: updated });
    }

    const confirmBody = revokeSchema.parse(json);
    const confirmed = await db.staffUser.update({
      where: { id: confirmBody.staffUserId },
      data: { confirmedAt: new Date(), invitationToken: null },
    });
    await writeAudit({
      action: AuditAction.STAFF_CONFIRMED,
      actorId: ctx.staff.id,
      targetId: confirmed.id,
    });
    return NextResponse.json({ ok: true, staff: confirmed });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
