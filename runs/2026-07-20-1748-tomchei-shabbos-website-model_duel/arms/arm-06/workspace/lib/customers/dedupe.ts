import { Customer, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeEmail, normalizeWhitespace } from "@/lib/text";
import { normalizePhone } from "@/lib/phone";

// Guest draft saves must never attach to a customer who has authenticated
// before: the guest path carries no ownership proof, so attaching would let
// anyone who knows an email write drafts/recipients into that account.
export class VerifiedCustomerExistsError extends Error {
  constructor() {
    super("An account already exists for this email — sign in to continue checkout");
    this.name = "VerifiedCustomerExistsError";
  }
}

// R-144: a new signup/checkout matching an existing customer on normalized
// email or phone attaches to that row instead of creating a duplicate.
// Concurrency: BOTH arms are backed by unique indexes (email, normalizedPhone),
// so a create that loses the race fails P2002 and falls back to the winner's
// row — two concurrent signups can never produce two customers.
export async function findOrCreateCustomer(input: {
  name: string;
  email: string;
  phone?: string | null;
}): Promise<{ customer: Customer; created: boolean }> {
  const email = normalizeEmail(input.email);
  const normalizedPhone = input.phone ? normalizePhone(input.phone) : null;

  const existing = await findByEmailOrPhone(email, normalizedPhone);
  if (existing) {
    // Email match carrying a phone we don't have yet: attach it (fill-empty
    // only — never overwrite an existing phone, and a unique conflict means
    // another customer already owns that number, so leave it there).
    if (normalizedPhone && !existing.normalizedPhone) {
      try {
        const updated = await prisma.customer.update({
          where: { id: existing.id },
          data: { phone: input.phone ?? null, normalizedPhone },
        });
        return { customer: updated, created: false };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    return { customer: existing, created: false };
  }

  try {
    const customer = await prisma.customer.create({
      data: {
        email,
        name: normalizeWhitespace(input.name),
        phone: input.phone ?? null,
        normalizedPhone,
      },
    });
    return { customer, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Lost the race on email or normalizedPhone: the winner's row is now visible.
    const winner = await findByEmailOrPhone(email, normalizedPhone);
    if (winner) return { customer: winner, created: false };
    throw error;
  }
}

function findByEmailOrPhone(
  email: string,
  normalizedPhone: string | null,
): Promise<Customer | null> {
  return prisma.customer.findFirst({
    where: {
      OR: [{ email }, ...(normalizedPhone ? [{ normalizedPhone }] : [])],
    },
  });
}

// Guest checkout identity: same dedupe as above, but a match on a VERIFIED
// customer (Clerk-linked or has ever held a session) refuses the attach —
// they must sign in. Guest-shadow rows (never authenticated) still dedupe, so
// a returning guest keeps one customer row.
export async function findOrCreateGuestCustomer(input: {
  name: string;
  email: string;
  phone?: string | null;
}): Promise<{ customer: Customer; created: boolean }> {
  const existing = await findByEmailOrPhone(
    normalizeEmail(input.email),
    input.phone ? normalizePhone(input.phone) : null,
  );
  if (existing) {
    const hasAuthenticated =
      existing.clerkUserId !== null ||
      (await prisma.customerSession.count({ where: { customerId: existing.id } })) > 0;
    if (hasAuthenticated) throw new VerifiedCustomerExistsError();
  }
  return findOrCreateCustomer(input);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
