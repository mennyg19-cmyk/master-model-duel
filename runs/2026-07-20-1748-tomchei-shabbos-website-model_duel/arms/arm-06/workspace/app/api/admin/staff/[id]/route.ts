import { NextResponse } from "next/server";
import { z } from "zod";
import { StaffRole } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { canManageStaffRole, canTargetStaff, PERMISSIONS } from "@/lib/permissions";

const patchSchema = z.object({
  version: z.number().int().min(1),
  role: z.nativeEnum(StaffRole).optional(),
  overrides: z
    .array(
      z.object({
        permission: z.enum(PERMISSIONS),
        effect: z.enum(["GRANT", "DENY"]).nullable(),
      }),
    )
    .optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiPermission("staff.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const parsed = await parseBody(request, patchSchema, "Expected { version, role?, overrides? }");
  if (!parsed.ok) return parsed.response;

  const target = await prisma.staffUser.findUnique({ where: { id }, include: { overrides: true } });
  if (!target) {
    return NextResponse.json({ error: "Staff account not found" }, { status: 404 });
  }

  const isRoleChange = parsed.data.role !== undefined && parsed.data.role !== target.role;
  const isOverrideWrite = parsed.data.overrides !== undefined;

  if ((isRoleChange || isOverrideWrite) && !canTargetStaff(gate.ctx.staff.id, id)) {
    return NextResponse.json({ error: "You cannot change your own role or permissions" }, { status: 400 });
  }
  if ((isRoleChange || isOverrideWrite) && !canManageStaffRole(gate.ctx.staff.role, target.role)) {
    return NextResponse.json({ error: "You cannot manage an account above your own role" }, { status: 403 });
  }
  if (isRoleChange && !canManageStaffRole(gate.ctx.staff.role, parsed.data.role!)) {
    return NextResponse.json({ error: "You cannot assign a role above your own" }, { status: 403 });
  }

  const explicitOverrides = (parsed.data.overrides ?? []).filter((entry) => entry.effect !== null);

  const { conflict } = await prisma.$transaction(async (tx) => {
    if (isOverrideWrite) {
      await tx.permissionOverride.deleteMany({ where: { staffUserId: id } });
      if (explicitOverrides.length > 0) {
        await tx.permissionOverride.createMany({
          data: explicitOverrides.map((entry) => ({
            staffUserId: id,
            permission: entry.permission,
            effect: entry.effect as "GRANT" | "DENY",
          })),
        });
      }
    } else if (isRoleChange) {
      // A role change without an explicit override rewrite clears overrides:
      // a demoted account must not keep GRANTs from its previous role.
      await tx.permissionOverride.deleteMany({ where: { staffUserId: id } });
    }

    // Optimistic concurrency: the version in the WHERE clause makes a stale
    // writer a no-op instead of a silent overwrite.
    const updated = await tx.staffUser.updateMany({
      where: { id, version: parsed.data.version },
      data: {
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return { conflict: true };

    if (isRoleChange) {
      await tx.auditLog.create({
        data: {
          actorId: gate.ctx.impersonator?.id ?? gate.ctx.staff.id,
          actorEmail: gate.ctx.impersonator?.email ?? gate.ctx.staff.email,
          action: "role_change",
          targetType: "StaffUser",
          targetId: id,
          metadata: {
            from: target.role,
            to: parsed.data.role,
            ...(!isOverrideWrite && target.overrides.length > 0 ? { overridesCleared: true } : {}),
            ...(gate.ctx.impersonator
              ? { impersonatedAs: { id: gate.ctx.staff.id, email: gate.ctx.staff.email } }
              : {}),
          },
        },
      });
    }
    if (isOverrideWrite) {
      await tx.auditLog.create({
        data: {
          actorId: gate.ctx.impersonator?.id ?? gate.ctx.staff.id,
          actorEmail: gate.ctx.impersonator?.email ?? gate.ctx.staff.email,
          action: "permission_override",
          targetType: "StaffUser",
          targetId: id,
          metadata: {
            before: target.overrides.map((entry) => ({ permission: entry.permission, effect: entry.effect })),
            after: explicitOverrides,
            ...(gate.ctx.impersonator
              ? { impersonatedAs: { id: gate.ctx.staff.id, email: gate.ctx.staff.email } }
              : {}),
          },
        },
      });
    }
    return { conflict: false };
  });

  if (conflict) {
    return NextResponse.json(
      { error: "Conflict: this account was changed by someone else. Reload and retry." },
      { status: 409 },
    );
  }
  const reloadedStaff = await prisma.staffUser.findUnique({ where: { id }, include: { overrides: true } });
  return NextResponse.json({ staff: reloadedStaff });
}
