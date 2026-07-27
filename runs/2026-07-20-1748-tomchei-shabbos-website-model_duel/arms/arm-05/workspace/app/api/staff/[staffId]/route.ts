import { NextResponse } from "next/server";
import { z } from "zod";
import { startImpersonation, revokeStaff, updateStaff } from "@/lib/staff-store";
import { permissions, type Permission } from "@/lib/permissions";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

const updateSchema = z.object({
  action: z.enum(["update", "revoke", "impersonate"]),
  version: z.number().int().positive().optional(),
  role: z.enum(["MANAGER", "STAFF", "DRIVER"]).optional(),
  overrides: z.partialRecord(z.enum(permissions), z.enum(["GRANT", "DENY"])).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ staffId: string }> },
) {
  const authorization = await authorize(request, "staff.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const { staffId } = await context.params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid staff update." }, { status: 400 });
  if (staffId === authorization.staffMember.id) {
    return NextResponse.json({ error: "You cannot change your own staff access." }, { status: 403 });
  }

  if (parsed.data.action === "revoke") {
    return await revokeStaff(authorization.staffMember.id, staffId)
      ? NextResponse.json({ message: "Staff access revoked." })
      : NextResponse.json({ error: "Staff account was not found." }, { status: 404 });
  }
  if (parsed.data.action === "impersonate") {
    return await startImpersonation(authorization.staffMember.id, staffId)
      ? NextResponse.json({ message: "Impersonation session started and audited." })
      : NextResponse.json({ error: "Only active staff can be impersonated." }, { status: 409 });
  }

  if (parsed.data.version === undefined || !parsed.data.role || !parsed.data.overrides) {
    return NextResponse.json({ error: "A version, role, and overrides are required." }, { status: 400 });
  }
  const outcome = await updateStaff(
    authorization.staffMember.id,
    staffId,
    parsed.data.version,
    { role: parsed.data.role, overrides: parsed.data.overrides as Partial<Record<Permission, "GRANT" | "DENY">> },
  );
  return outcome.ok
    ? NextResponse.json({ staffMember: outcome.staffMember })
    : NextResponse.json({ error: outcome.reason }, { status: outcome.status });
}
