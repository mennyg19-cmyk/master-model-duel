import 'server-only';

import { Prisma, type Customer } from '@prisma/client';
import { z } from 'zod';

import { recordAudit, type AuditActor } from './audit';
import { getExternalIdentity, type ExternalIdentity } from './auth/identity';
import { normalizeEmail } from './core/normalize';
import { normalizePhone } from './core/phone';
import { failure, ok, type Result } from './core/result';
import { db } from './db';
import { env } from './env';

/**
 * Customers live in their own table and never gain staff access (UR-012).
 * Linking matches an auth account to an existing customer by normalized email
 * the first time they sign in, then keeps the external id as the strong key.
 */
export async function linkCustomerIdentity(identity: ExternalIdentity): Promise<Customer> {
  const normalizedEmail = normalizeEmail(identity.email);

  const existing = await findCustomer(identity.externalId, normalizedEmail);
  if (existing) return attachExternalId(existing, identity.externalId);

  try {
    return await db.customer.create({
      data: {
        externalAuthId: identity.externalId,
        email: identity.email,
        normalizedEmail,
        fullName: identity.fullName,
      },
    });
  } catch (error) {
    const isDuplicate =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
    if (!isDuplicate) throw error;

    // Two first-time links for the same person can both miss the lookups above.
    // The loser reads the row the winner created instead of returning a 500.
    const winner = await findCustomer(identity.externalId, normalizedEmail);
    if (!winner) throw error;
    return attachExternalId(winner, identity.externalId);
  }
}

/** The external id is the strong key; the normalized email is the fallback match. */
async function findCustomer(externalId: string, normalizedEmail: string): Promise<Customer | null> {
  const byExternalId = await db.customer.findUnique({ where: { externalAuthId: externalId } });
  return byExternalId ?? (await db.customer.findUnique({ where: { normalizedEmail } }));
}

async function attachExternalId(customer: Customer, externalId: string): Promise<Customer> {
  if (customer.externalAuthId === externalId) return customer;
  return db.customer.update({ where: { id: customer.id }, data: { externalAuthId: externalId } });
}

/**
 * The customer this browser is signed in as, or null.
 *
 * With Clerk the account already exists at the provider, so the first visit to
 * the account area is where the local `Customer` row appears. The local provider
 * has no provider to ask, so its own sign-in form creates the row and this
 * function only ever looks one up — which is also why a staff member signing in
 * locally never quietly becomes a customer.
 */
export async function getCurrentCustomer(): Promise<Customer | null> {
  const identity = await getExternalIdentity();
  if (!identity) return null;

  if (env.AUTH_PROVIDER === 'clerk') return linkCustomerIdentity(identity);

  const existing = await findCustomer(identity.externalId, normalizeEmail(identity.email));
  return existing ? attachExternalId(existing, identity.externalId) : null;
}

/**
 * The local provider's "register or sign in": an address that has ordered before
 * is the same customer, a new one starts an account. Passwords are Clerk's job —
 * `startLocalSession` refuses to run anywhere but a loopback development box.
 */
export async function findOrCreateLocalCustomer(input: {
  email: string;
  fullName: string;
}): Promise<Result<Customer>> {
  const parsed = localSignInSchema.safeParse(input);
  if (!parsed.success) return failure(INVALID_CUSTOMER_INPUT, parsed.error.issues[0].message);

  const normalizedEmail = normalizeEmail(parsed.data.email);
  const existing = await db.customer.findUnique({ where: { normalizedEmail } });
  if (existing) return ok(existing);

  return ok(
    await db.customer.create({
      data: {
        email: parsed.data.email.trim(),
        normalizedEmail,
        fullName: parsed.data.fullName,
        externalAuthId: `local:${normalizedEmail}`,
      },
    }),
  );
}

export type CustomerDirectoryRow = Customer & {
  _count: { orders: number; addresses: number };
};

/**
 * The staff directory (R-041). Staff look people up by whatever the caller on the
 * phone gives them, so one box searches name, email and phone — the phone in its
 * normalized form, because nobody reads out the punctuation they typed.
 */
export async function searchCustomers(query: string): Promise<CustomerDirectoryRow[]> {
  const term = query.trim();
  const digits = normalizePhone(term);

  return db.customer.findMany({
    where: term
      ? {
          OR: [
            { fullName: { contains: term, mode: 'insensitive' } },
            { normalizedEmail: { contains: normalizeEmail(term) } },
            ...(digits ? [{ normalizedPhone: digits }] : []),
          ],
        }
      : undefined,
    include: { _count: { select: { orders: true, addresses: true } } },
    orderBy: { fullName: 'asc' },
    take: 50,
  });
}

export const INVALID_CUSTOMER_INPUT = 'invalid_customer_input';
export const DUPLICATE_CUSTOMER_PHONE = 'duplicate_customer_phone';

const localSignInSchema = z.object({
  email: z.string().trim().email('Enter the email address you order with.'),
  fullName: z.string().trim().min(1, 'Enter your name.').max(120),
});

const profileSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your name.').max(120),
  phone: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .refine((value) => value === null || normalizePhone(value) !== null, {
      message: 'Enter a 10-digit US phone number, or leave it blank.',
    }),
});

export type ProfileInput = z.input<typeof profileSchema>;

/**
 * R-042. The customer is passed in, never named by the form: the only profile a
 * request can edit is the one its own session resolved to.
 */
export async function updateCustomerProfile(
  customer: Customer,
  input: ProfileInput,
  actor: AuditActor = null,
): Promise<Result<Customer>> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return failure(INVALID_CUSTOMER_INPUT, parsed.error.issues[0].message);

  const phone = parsed.data.phone;

  try {
    const updated = await db.customer.update({
      where: { id: customer.id },
      data: {
        fullName: parsed.data.fullName,
        phone,
        normalizedPhone: phone === null ? null : normalizePhone(phone),
      },
    });

    await recordAudit(actor, {
      action: 'customer.profile_updated',
      entityType: 'Customer',
      entityId: updated.id,
      detail: { changedPhone: customer.normalizedPhone !== updated.normalizedPhone },
    });

    return ok(updated);
  } catch (error) {
    const isDuplicate =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
    if (!isDuplicate) throw error;

    // The phone number is unique so a POS entry cannot split one household into
    // two customers (R-144). Saying which record holds it would leak it.
    return failure(
      DUPLICATE_CUSTOMER_PHONE,
      'That phone number is already on another account. Call the office and we will merge them.',
    );
  }
}
