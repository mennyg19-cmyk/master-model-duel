import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";

const patchSchema = z.object({
  role: z.enum(["MANAGER", "STAFF", "DRIVER"]).optional(),
  status: z.enum(["ACTIVE", "REVOKED"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("staff.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  if (id === gate.staff.realUser.id) {
    return Response.json(
      { error: "You cannot change your own role or revoke your own account" },
      { status: 400 }
    );
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (!parsed.data.role && !parsed.data.status)) {
    return Response.json({ error: "Provide a role or status to change" }, { status: 400 });
  }

  const target = await db.staffUser.findUnique({ where: { id } });
  if (!target) return Response.json({ error: "Staff member not found" }, { status: 404 });

  // One transaction: mutation, session invalidation, and audit commit or roll back together.
  await db.$transaction(async (tx) => {
    const updated = await tx.staffUser.update({ where: { id }, data: parsed.data });

    // Any role or status change kills the target's live sessions so the old
    // privilege set cannot outlive the change — they sign in again with the new one.
    await tx.session.deleteMany({ where: { staffUserId: id } });

    await writeAudit(
      gate.staff,
      {
        action: parsed.data.role ? "staff.role_change" : "staff.status_change",
        targetType: "StaffUser",
        targetId: id,
        detail: {
          email: target.email,
          from: { role: target.role, status: target.status },
          to: { role: updated.role, status: updated.status },
        },
      },
      tx
    );
  });
  return Response.json({ ok: true });
}
