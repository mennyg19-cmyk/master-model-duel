import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isDevAuthBypass } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import {
  clearSessionResponse,
  createLoginSession,
  getSession,
  issueSessionResponse,
  revokeLoginSession,
} from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";

const loginSchema = z.object({ staffUserId: z.string().min(1) });

export async function POST(request: Request) {
  if (!isDevAuthBypass) {
    return NextResponse.json(
      { error: "Dev auth is disabled. Set DEV_AUTH_BYPASS=true for local testing only." },
      { status: 404 },
    );
  }

  const parsed = await parseBody(request, loginSchema, "staffUserId is required");
  if (!parsed.ok) return parsed.response;

  const staff = await prisma.staffUser.findUnique({ where: { id: parsed.data.staffUserId } });
  if (!staff || staff.status !== "ACTIVE") {
    return NextResponse.json({ error: "No active staff account for that id" }, { status: 403 });
  }

  await recordAudit({
    actor: { id: staff.id, email: staff.email },
    action: "session_login",
    targetType: "StaffUser",
    targetId: staff.id,
    metadata: { method: "dev-auth" },
  });

  const authSession = await createLoginSession(staff.id);
  return issueSessionResponse({ staffUserId: staff.id, authSessionId: authSession.id }, { ok: true });
}

export async function DELETE() {
  // Server-side revocation, not just a client-side cookie clear.
  const session = await getSession();
  if (session) {
    await revokeLoginSession(session.authSessionId);
  }
  return clearSessionResponse();
}
