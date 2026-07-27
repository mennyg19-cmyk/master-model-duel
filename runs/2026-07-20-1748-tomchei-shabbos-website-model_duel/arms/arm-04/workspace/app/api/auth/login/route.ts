import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyPassword } from "@/lib/auth/passwords";
import { createSession } from "@/lib/auth/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const ATTEMPT_LIMIT_PER_IP = 20;
const ATTEMPT_LIMIT_PER_ACCOUNT = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  if (env.AUTH_MODE !== "dev") {
    return Response.json({ error: "Password login is disabled when Clerk auth is active" }, { status: 404 });
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  // Brute-force protection: throttle per-IP and per-account before touching credentials.
  const ipAllowed = rateLimit(`login:ip:${clientIp(request)}`, ATTEMPT_LIMIT_PER_IP, ATTEMPT_WINDOW_MS);
  const accountAllowed = rateLimit(
    `login:email:${parsed.data.email.toLowerCase()}`,
    ATTEMPT_LIMIT_PER_ACCOUNT,
    ATTEMPT_WINDOW_MS
  );
  if (!ipAllowed || !accountAllowed) {
    return Response.json(
      { error: "Too many sign-in attempts. Try again in a few minutes." },
      { status: 429 }
    );
  }

  const staffUser = await db.staffUser.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  const passwordMatches =
    staffUser?.passwordHash && verifyPassword(parsed.data.password, staffUser.passwordHash);

  if (!staffUser || !passwordMatches || staffUser.status !== "ACTIVE") {
    // One message for all failure kinds so the endpoint doesn't leak which emails exist.
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await db.staffUser.update({
    where: { id: staffUser.id },
    data: { lastLoginAt: new Date() },
  });
  await createSession(staffUser.id);
  return Response.json({ ok: true });
}
