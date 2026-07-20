import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi, getStaffContext } from "@/lib/auth/current-user";
import { setImpersonation } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";

const startSchema = z.object({ staffUserId: z.string().min(1) });

export async function POST(request: Request) {
  const gate = await requirePermissionApi("staff.impersonate");
  if ("response" in gate) return gate.response;
  if (gate.staff.isImpersonating) {
    return Response.json({ error: "Already impersonating; stop first" }, { status: 400 });
  }

  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "staffUserId is required" }, { status: 400 });
  if (parsed.data.staffUserId === gate.staff.realUser.id) {
    return Response.json({ error: "You cannot impersonate yourself" }, { status: 400 });
  }

  const target = await db.staffUser.findUnique({ where: { id: parsed.data.staffUserId } });
  if (!target || target.status !== "ACTIVE") {
    return Response.json({ error: "Target staff member not found or not active" }, { status: 404 });
  }

  await setImpersonation(gate.staff.sessionId, target.id);
  await writeAudit(gate.staff, {
    action: "staff.impersonation_start",
    targetType: "StaffUser",
    targetId: target.id,
    detail: { email: target.email },
  });
  return Response.json({ ok: true });
}

export async function DELETE() {
  const staff = await getStaffContext();
  if (!staff) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!staff.isImpersonating) return Response.json({ error: "Not impersonating" }, { status: 400 });

  await setImpersonation(staff.sessionId, null);
  await writeAudit(staff, {
    action: "staff.impersonation_stop",
    targetType: "StaffUser",
    targetId: staff.actingAs.id,
    detail: { email: staff.actingAs.email },
  });
  return Response.json({ ok: true });
}
