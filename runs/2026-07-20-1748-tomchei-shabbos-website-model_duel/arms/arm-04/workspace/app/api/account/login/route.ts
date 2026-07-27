import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyPassword } from "@/lib/auth/passwords";
import { createCustomerSession } from "@/lib/auth/customer-session";
import { clearGuestDraftCookie } from "@/lib/order-builder/draft-store";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  if (env.AUTH_MODE !== "dev") {
    return Response.json({ error: "Password login is disabled when Clerk auth is active" }, { status: 404 });
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  const ipAllowed = rateLimit(`customer-login:ip:${clientIp(request)}`, 20, 15 * 60 * 1000);
  const accountAllowed = rateLimit(
    `customer-login:email:${parsed.data.email.toLowerCase()}`,
    10,
    15 * 60 * 1000
  );
  if (!ipAllowed || !accountAllowed) {
    return Response.json({ error: "Too many sign-in attempts. Try again in a few minutes." }, { status: 429 });
  }

  const customer = await db.customer.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  const passwordMatches =
    customer?.passwordHash && verifyPassword(parsed.data.password, customer.passwordHash);
  if (!customer || !passwordMatches) {
    // One message for every failure kind so the endpoint doesn't leak which emails exist.
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await createCustomerSession(customer.id);
  // A guest draft from before sign-in must not linger on the device (it would
  // resurface for the next user after sign-out).
  await clearGuestDraftCookie();
  return Response.json({ ok: true });
}
