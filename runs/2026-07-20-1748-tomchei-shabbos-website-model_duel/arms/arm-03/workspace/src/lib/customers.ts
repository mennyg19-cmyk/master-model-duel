import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";
import { normalizePhone } from "@/lib/phone";
import { err, ok, type Result } from "@/lib/result";

export async function linkOrCreateCustomer(input: {
  clerkUserId: string;
  email?: string | null;
  /** Required true before email-match linking (B1). Dev identities default verified. */
  emailVerified?: boolean;
  phone?: string | null;
  displayName: string;
}): Promise<Result<{ customerId: string; linked: boolean }>> {
  const email = input.email ? normalizeEmail(input.email) : null;
  const phoneNorm = input.phone ? normalizePhone(input.phone) : null;
  const canLinkByEmail = Boolean(email && input.emailVerified === true);

  const existingByClerk = await db.customer.findUnique({
    where: { clerkUserId: input.clerkUserId },
  });
  if (existingByClerk) {
    return ok({ customerId: existingByClerk.id, linked: true });
  }

  if (canLinkByEmail && email) {
    const byEmail =
      (await db.customer.findUnique({ where: { emailNorm: email } })) ??
      (await db.customer.findUnique({ where: { email } }));
    if (byEmail) {
      const linked = await db.customer.update({
        where: { id: byEmail.id },
        data: {
          clerkUserId: input.clerkUserId,
          email,
          emailNorm: email,
        },
      });
      return ok({ customerId: linked.id, linked: true });
    }
  }

  // Customers must never land in StaffUser — separate table only.
  const staffCollision = email
    ? await db.staffUser.findUnique({ where: { email } })
    : null;
  if (staffCollision) {
    return err(
      "email belongs to staff",
      "This email is a staff account. Use a customer email instead.",
    );
  }

  // Unverified emails must not claim an existing customer's emailNorm unique slot.
  const storeEmail = canLinkByEmail ? email : null;
  const created = await db.customer.create({
    data: {
      clerkUserId: input.clerkUserId,
      email: storeEmail,
      emailNorm: storeEmail,
      phone: input.phone ?? null,
      phoneNorm,
      displayName: input.displayName,
    },
  });
  return ok({ customerId: created.id, linked: false });
}
