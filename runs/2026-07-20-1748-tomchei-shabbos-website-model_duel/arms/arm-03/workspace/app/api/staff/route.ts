import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/passwords";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  const gate = await requirePermissionApi("staff.manage");
  if ("response" in gate) return gate.response;

  const staff = await db.staffUser.findMany({
    omit: { passwordHash: true },
    include: { permissionOverrides: true },
    orderBy: { createdAt: "asc" },
  });
  return Response.json(staff);
}

const createStaffSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["MANAGER", "STAFF", "DRIVER"]),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  const gate = await requirePermissionApi("staff.manage");
  if ("response" in gate) return gate.response;

  const parsed = createStaffSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await db.staffUser.findUnique({ where: { email } });
  if (existing) {
    return Response.json({ error: `A staff account for ${email} already exists` }, { status: 409 });
  }

  // One transaction: the staff row and its audit entry commit together.
  const created = await db.$transaction(async (tx) => {
    const staffUser = await tx.staffUser.create({
      data: {
        name: parsed.data.name,
        email,
        role: parsed.data.role,
        passwordHash: hashPassword(parsed.data.password),
      },
    });
    await writeAudit(
      gate.staff,
      {
        action: "staff.create",
        targetType: "StaffUser",
        targetId: staffUser.id,
        detail: { email: staffUser.email, role: staffUser.role },
      },
      tx
    );
    return staffUser;
  });
  return Response.json({ ok: true, id: created.id }, { status: 201 });
}
