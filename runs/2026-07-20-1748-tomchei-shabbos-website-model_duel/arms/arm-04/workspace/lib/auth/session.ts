import { createHmac, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "tomchei_session";
const SESSION_TTL_HOURS = 12;

// HMAC (keyed by SESSION_SECRET) instead of plain SHA-256: a leaked Session table
// alone cannot be used to forge lookups, and rotating the secret revokes all sessions.
function hashToken(token: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(token).digest("hex");
}

export async function createSession(staffUserId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      staffUserId,
      expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000),
    },
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_HOURS * 3600,
  });
}

export async function readSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { staffUser: { include: { permissionOverrides: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function setImpersonation(sessionId: string, impersonatedStaffId: string | null) {
  await db.session.update({ where: { id: sessionId }, data: { impersonatedStaffId } });
}
