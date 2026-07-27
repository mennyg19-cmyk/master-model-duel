import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashPassword } from "@/lib/auth/passwords";
import { createCustomerSession } from "@/lib/auth/customer-session";
import { verifyRegistrationToken } from "@/lib/auth/registration-token";
import { clearGuestDraftCookie } from "@/lib/order-builder/draft-store";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// Second half of registration against an existing passwordless customer
// (SR-01): the emailed signed token proves control of the address, then the
// password is attached here.

const completeSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export async function POST(request: Request) {
  if (env.AUTH_MODE !== "dev") {
    return Response.json({ error: "Registration is handled by Clerk when Clerk auth is active" }, { status: 404 });
  }
  if (!rateLimit(`register-complete:${clientIp(request)}`, 10, 15 * 60 * 1000)) {
    return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  const parsed = completeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const email = verifyRegistrationToken(parsed.data.token);
  if (!email) {
    return Response.json({ error: "This confirmation link is invalid or has expired — register again to get a fresh one" }, { status: 400 });
  }

  const customer = await db.customer.findUnique({ where: { email } });
  if (!customer) {
    return Response.json({ error: "This confirmation link is invalid or has expired — register again to get a fresh one" }, { status: 400 });
  }
  if (customer.passwordHash) {
    // A password landed since the email went out (this link used twice, or a
    // parallel registration) — the account exists, so send them to sign-in.
    return Response.json({ error: "This account is already set up — sign in with your password" }, { status: 409 });
  }

  await db.customer.update({
    where: { id: customer.id },
    data: { passwordHash: hashPassword(parsed.data.password) },
  });
  await createCustomerSession(customer.id);
  // A shared-device guest draft must not follow the new account (cookie leak).
  await clearGuestDraftCookie();
  return Response.json({ ok: true }, { status: 200 });
}
