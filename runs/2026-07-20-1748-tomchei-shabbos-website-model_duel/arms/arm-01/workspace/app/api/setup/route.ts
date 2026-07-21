import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/passwords";
import { createSession } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";

const setupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function GET() {
  const staffCount = await db.staffUser.count();
  return Response.json({ locked: staffCount > 0 });
}

// Bootstraps the first manager on an empty database, then locks permanently.
export async function POST(request: Request) {
  const parsed = setupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { name, email, password } = parsed.data;

  // Transaction guards against two concurrent bootstrap attempts both passing the
  // count check, and commits the audit entry atomically with the manager row.
  const created = await db.$transaction(async (tx) => {
    const staffCount = await tx.staffUser.count();
    if (staffCount > 0) return null;
    const manager = await tx.staffUser.create({
      data: {
        name,
        email: email.toLowerCase(),
        role: "MANAGER",
        passwordHash: hashPassword(password),
      },
    });
    await writeAudit(
      null,
      {
        action: "setup.bootstrap_manager",
        targetType: "StaffUser",
        targetId: manager.id,
        detail: { email: manager.email },
      },
      tx
    );
    return manager;
  });

  if (!created) {
    return Response.json(
      { error: "Setup is locked: staff accounts already exist" },
      { status: 423 }
    );
  }

  await createSession(created.id);
  return Response.json({ ok: true, staffUserId: created.id }, { status: 201 });
}
