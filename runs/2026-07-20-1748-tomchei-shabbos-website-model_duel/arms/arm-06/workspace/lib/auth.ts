import { cache } from "react";
import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { AuthSession, StaffUser, PermissionOverride } from "@prisma/client";
import { env, isDevAuthBypass } from "@/lib/env";
import { prisma } from "@/lib/db";
import { hasPermission, Permission } from "@/lib/permissions";
import { decodeSession, encodeSession, SESSION_COOKIE, SessionPayload } from "@/lib/session-codec";
import { clientIp } from "@/lib/client-ip";

export const SESSION_TTL_HOURS = 12;

export type StaffWithOverrides = StaffUser & { overrides: PermissionOverride[] };

export interface AuthContext {
  session: SessionPayload;
  staff: StaffWithOverrides;
  impersonator: StaffWithOverrides | null;
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return decodeSession(raw, env.AUTH_SECRET);
}

// Deduped per request so layout + page + actions share one validation pass.
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await getSession();
  if (!session) return null;

  // Server-side session check: a cookie alone is not enough — the session
  // must exist, be unexpired, and not be revoked.
  const authSession = await prisma.authSession.findUnique({
    where: { id: session.authSessionId },
  });
  if (!authSession || authSession.revokedAt || authSession.expiresAt < new Date()) {
    return null;
  }

  const staff = await prisma.staffUser.findUnique({
    where: { id: session.staffUserId },
    include: { overrides: true },
  });
  // Revoked or confirmed-out accounts fail the very next protected request.
  if (!staff || staff.status !== "ACTIVE") return null;

  let impersonator: StaffWithOverrides | null = null;
  if (session.impersonatorId) {
    impersonator = await prisma.staffUser.findUnique({
      where: { id: session.impersonatorId },
      include: { overrides: true },
    });
  }
  return { session, staff, impersonator };
});

export async function requireStaff(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect(isDevAuthBypass ? "/dev-login" : "/");
  return ctx;
}

export async function requirePermission(permission: Permission): Promise<AuthContext> {
  const ctx = await requireStaff();
  if (!hasPermission(ctx.staff, permission)) forbidden();
  return ctx;
}

type ApiGate = { ok: true; ctx: AuthContext } | { ok: false; response: NextResponse };

export async function requireApiPermission(permission: Permission): Promise<ApiGate> {
  const ctx = await getAuthContext();
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!hasPermission(ctx.staff, permission)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, ctx };
}

// Creates the server-side session row every login path shares (setup,
// dev-auth, invite-confirm) so expiry, IP, and user-agent are captured
// consistently. x-forwarded-for is client-controllable: first hop only,
// capped — it is audit metadata, never an auth input.
export async function createLoginSession(staffUserId: string): Promise<AuthSession> {
  const headerStore = await headers();
  const ip = clientIp(headerStore);
  return prisma.authSession.create({
    data: {
      staffUserId,
      ip,
      userAgent: headerStore.get("user-agent"),
      expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000),
    },
  });
}

export async function revokeLoginSession(authSessionId: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { id: authSessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_HOURS * 60 * 60,
  };
}

// Single cookie-issuance path for all five session-issuing routes.
export async function issueSessionResponse(
  payload: SessionPayload,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const sessionValue = await encodeSession(payload, env.AUTH_SECRET);
  const response = NextResponse.json(body);
  response.cookies.set(SESSION_COOKIE, sessionValue, sessionCookieOptions());
  return response;
}

export function clearSessionResponse(): NextResponse {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}
