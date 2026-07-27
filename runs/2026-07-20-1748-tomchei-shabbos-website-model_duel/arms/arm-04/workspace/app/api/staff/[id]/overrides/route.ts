import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit";

const overridesSchema = z.object({
  overrides: z.array(
    z.object({
      permission: z.enum(ALL_PERMISSIONS as [string, ...string[]]),
      effect: z.enum(["GRANT", "DENY"]),
    })
  ),
});

// Replaces the target's full override list (tri-state editor sends the complete set).
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("staff.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  if (id === gate.staff.realUser.id) {
    return Response.json({ error: "You cannot edit your own permission overrides" }, { status: 400 });
  }

  const parsed = overridesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const target = await db.staffUser.findUnique({
    where: { id },
    include: { permissionOverrides: true },
  });
  if (!target) return Response.json({ error: "Staff member not found" }, { status: 404 });

  // One transaction: override swap, session invalidation, and audit are atomic.
  await db.$transaction(async (tx) => {
    await tx.permissionOverride.deleteMany({ where: { staffUserId: id } });
    await tx.permissionOverride.createMany({
      data: parsed.data.overrides.map((override) => ({ staffUserId: id, ...override })),
    });

    // Permission change kills the target's live sessions so the old grant set
    // cannot outlive the change (defense against any future upstream caching).
    await tx.session.deleteMany({ where: { staffUserId: id } });

    await writeAudit(
      gate.staff,
      {
        action: "staff.permission_overrides_change",
        targetType: "StaffUser",
        targetId: id,
        detail: {
          email: target.email,
          before: target.permissionOverrides.map(({ permission, effect }) => ({ permission, effect })),
          after: parsed.data.overrides,
        },
      },
      tx
    );
  });
  return Response.json({ ok: true });
}
