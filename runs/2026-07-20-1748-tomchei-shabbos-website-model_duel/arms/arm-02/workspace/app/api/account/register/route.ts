import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashPassword, verifyPassword } from "@/lib/auth/passwords";
import { createCustomerSession } from "@/lib/auth/customer-session";
import { findOrLinkCustomer } from "@/lib/customers";
import { clearGuestDraftCookie } from "@/lib/order-builder/draft-store";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const registerSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  phone: z.string().max(30).optional(),
});

export async function POST(request: Request) {
  if (env.AUTH_MODE !== "dev") {
    return Response.json({ error: "Registration is handled by Clerk when Clerk auth is active" }, { status: 404 });
  }
  if (!rateLimit(`register:${clientIp(request)}`, 10, 15 * 60 * 1000)) {
    return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  // Staff phone orders may already have created this customer — link by email
  // only (never phone) and set the password. Anti-enumeration: the response is
  // the same {ok:true} whether the email was fresh, passwordless, or already
  // registered — no 409 confirming which emails have accounts.
  const customer = await findOrLinkCustomer({
    email: parsed.data.email,
    name: parsed.data.name,
    phone: parsed.data.phone,
  });

  if (customer.passwordHash) {
    // Already registered. If the supplied password happens to be correct this
    // is just a sign-in; otherwise return the generic success WITHOUT a
    // session — the caller lands on the sign-in flow.
    if (verifyPassword(parsed.data.password, customer.passwordHash)) {
      await createCustomerSession(customer.id);
      await clearGuestDraftCookie();
    }
    return Response.json({ ok: true }, { status: 200 });
  }

  await db.customer.update({
    where: { id: customer.id },
    data: { passwordHash: hashPassword(parsed.data.password), name: parsed.data.name },
  });
  await createCustomerSession(customer.id);
  // A shared-device guest draft must not follow the new account (cookie leak).
  await clearGuestDraftCookie();
  return Response.json({ ok: true }, { status: 200 });
}
