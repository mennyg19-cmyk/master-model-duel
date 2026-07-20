import { db } from "@/lib/db";

// Digits-only phone for dedupe (R-144). US-centric: a leading 1 on an
// 11-digit number is stripped so "+1 (555) 123-4567" and "555-123-4567" match.
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length > 0 ? digits : null;
}

// Links a customer record to a login identity (Clerk user id in clerk mode).
// Matches by identity first, then by email. Phone is NEVER used for matching:
// supplying someone else's phone number must not link you to (or let you set a
// password on) their record — knowing a phone number proves nothing (B1 fix).
// Phone dedupe for staff-entered orders stays a staff-side concern.
export async function findOrLinkCustomer(identity: {
  email: string;
  name: string;
  phone?: string;
  authUserId?: string;
}) {
  const email = identity.email.toLowerCase();
  const phoneNormalized = normalizePhone(identity.phone);
  // phoneNormalized is unique; a number already on another record is stored
  // raw-only so an attacker can't crash registration (or claim the number).
  const phoneOwner = phoneNormalized
    ? await db.customer.findUnique({ where: { phoneNormalized } })
    : null;

  if (identity.authUserId) {
    const byIdentity = await db.customer.findUnique({
      where: { clerkUserId: identity.authUserId },
    });
    if (byIdentity) return byIdentity;
  }

  const existing = await db.customer.findUnique({ where: { email } });
  if (existing) {
    const patch: { clerkUserId?: string; phone?: string; phoneNormalized?: string } = {};
    if (identity.authUserId && !existing.clerkUserId) patch.clerkUserId = identity.authUserId;
    if (phoneNormalized && !existing.phoneNormalized && !phoneOwner) {
      patch.phone = identity.phone;
      patch.phoneNormalized = phoneNormalized;
    }
    if (Object.keys(patch).length > 0) {
      return db.customer.update({ where: { id: existing.id }, data: patch });
    }
    return existing;
  }

  return db.customer.create({
    data: {
      email,
      name: identity.name,
      phone: identity.phone,
      phoneNormalized: phoneOwner ? null : phoneNormalized,
      clerkUserId: identity.authUserId,
    },
  });
}
