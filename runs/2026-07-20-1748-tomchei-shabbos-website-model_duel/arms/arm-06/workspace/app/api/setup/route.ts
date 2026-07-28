import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { setSetting } from "@/lib/settings";
import { createLoginSession, issueSessionResponse } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { normalizeEmail, normalizeWhitespace } from "@/lib/text";

const setupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export async function POST(request: Request) {
  const parsed = await parseBody(request, setupSchema, "Name and a valid email are required");
  if (!parsed.ok) return parsed.response;

  // Advisory lock makes the empty-database check atomic: two concurrent
  // bootstraps cannot both create the first manager.
  const manager = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1)`;
    const staffCount = await tx.staffUser.count();
    if (staffCount > 0) return null;
    return tx.staffUser.create({
      data: {
        email: normalizeEmail(parsed.data.email),
        name: normalizeWhitespace(parsed.data.name),
        role: "MANAGER",
        status: "ACTIVE",
        confirmedAt: new Date(),
      },
    });
  });

  if (!manager) {
    return NextResponse.json(
      { error: "Setup is locked: a staff account already exists" },
      { status: 409 },
    );
  }

  await setSetting("setup.completed", true);
  await recordAudit({
    actor: { id: manager.id, email: manager.email },
    action: "bootstrap_manager",
    targetType: "StaffUser",
    targetId: manager.id,
  });

  const authSession = await createLoginSession(manager.id);
  return issueSessionResponse({ staffUserId: manager.id, authSessionId: authSession.id }, { ok: true });
}
