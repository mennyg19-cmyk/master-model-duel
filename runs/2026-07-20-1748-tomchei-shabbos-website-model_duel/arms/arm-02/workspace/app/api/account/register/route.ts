import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { BRAND } from "@/lib/brand";
import { hashPassword, verifyPassword } from "@/lib/auth/passwords";
import { createCustomerSession } from "@/lib/auth/customer-session";
import { createRegistrationToken } from "@/lib/auth/registration-token";
import { findOrLinkCustomer } from "@/lib/customers";
import { captureNotification } from "@/lib/notifications";
import { clearGuestDraftCookie } from "@/lib/order-builder/draft-store";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const registerSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  phone: z.string().max(30).optional(),
});

// One outbox row per email per window: repeat submits within the window are
// deduped, so registration can't be used to flood a victim's inbox.
function emailDedupeBucket(): number {
  return Math.floor(Date.now() / (15 * 60 * 1000));
}

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

  const email = parsed.data.email.toLowerCase();
  // Direct lookup, NOT findOrLinkCustomer: an unverified registration attempt
  // must not patch anything (phone, name) onto a row it doesn't own yet.
  const existing = await db.customer.findUnique({ where: { email } });

  // Fresh email: instant account + session, exactly as before.
  if (!existing) {
    const customer = await findOrLinkCustomer({
      email,
      name: parsed.data.name,
      phone: parsed.data.phone,
    });
    await db.customer.update({
      where: { id: customer.id },
      data: { passwordHash: hashPassword(parsed.data.password), name: parsed.data.name },
    });
    await createCustomerSession(customer.id);
    // A shared-device guest draft must not follow the new account (cookie leak).
    await clearGuestDraftCookie();
    return Response.json({ ok: true }, { status: 200 });
  }

  if (existing.passwordHash) {
    // Already registered. If the supplied password happens to be correct this
    // is just a sign-in; otherwise the generic pending response below — no
    // 409 confirming which emails have accounts (anti-enumeration).
    if (verifyPassword(parsed.data.password, existing.passwordHash)) {
      await createCustomerSession(existing.id);
      await clearGuestDraftCookie();
      return Response.json({ ok: true }, { status: 200 });
    }
    await captureNotification({
      channel: "EMAIL",
      recipient: existing.email,
      kind: "account_exists",
      subject: `${BRAND.name} — you already have an account`,
      body: `Someone (hopefully you) tried to create a ${BRAND.name} account with this email, but one already exists. Sign in at ${env.APP_URL}/signin — if this wasn't you, no action is needed.`,
      dedupeKey: `account-exists|${existing.email}|${emailDedupeBucket()}`,
      customerId: existing.id,
    });
    return Response.json({ ok: true, pendingVerification: true }, { status: 200 });
  }

  // Existing passwordless row (staff phone order / guest checkout history):
  // attaching a password hands over that record's orders and addresses, so it
  // requires proof of email control first (SR-01) — a signed link that opens
  // the set-password page. The response is the same pending shape as the
  // registered branch above, so nothing leaks about the email's status.
  await captureNotification({
    channel: "EMAIL",
    recipient: existing.email,
    kind: "account_verify",
    subject: `${BRAND.name} — confirm your email to finish creating your account`,
    body: `Welcome to ${BRAND.name}! To finish creating your account, confirm this email address and choose your password here: ${env.APP_URL}/verify-email?token=${createRegistrationToken(existing.email)} (the link is valid for 24 hours). If you didn't request this, ignore this email.`,
    dedupeKey: `account-verify|${existing.email}|${emailDedupeBucket()}`,
    customerId: existing.id,
  });
  return Response.json({ ok: true, pendingVerification: true }, { status: 200 });
}
