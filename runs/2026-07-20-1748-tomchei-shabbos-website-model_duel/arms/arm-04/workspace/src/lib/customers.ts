import 'server-only';

import { Prisma, type Customer } from '@prisma/client';
import { z } from 'zod';

import { pageInfo, type PageInfo, type PageRequest } from './admin/list-query';
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
 * The staff directory (R-041, R-062). Staff look people up by whatever the
 * caller on the phone gives them, so one box searches name, email and phone —
 * the phone in its normalized form, because nobody reads out the punctuation
 * they typed.
 */
export function customerSearchWhere(query: string): Prisma.CustomerWhereInput | undefined {
  const term = query.trim();
  if (term === '') return undefined;

  const digits = normalizePhone(term);
  return {
    OR: [
      { fullName: { contains: term, mode: 'insensitive' } },
      { normalizedEmail: { contains: normalizeEmail(term) } },
      ...(digits ? [{ normalizedPhone: digits }] : []),
    ],
  };
}

/** A page of the directory. Bounded like every other admin list (G-024). */
export async function listCustomerDirectory(
  query: string,
  request: PageRequest,
): Promise<{ rows: CustomerDirectoryRow[]; page: PageInfo }> {
  const where = customerSearchWhere(query);

  const [totalCount, rows] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      include: {
        _count: {
          select: {
            // A cart somebody abandoned is not an order they placed.
            orders: { where: { status: { notIn: ['DRAFT', 'DISCARDED'] } } },
            addresses: { where: { isArchived: false } },
          },
        },
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      skip: request.skip,
      take: request.take,
    }),
  ]);

  return { rows, page: pageInfo(request, totalCount) };
}

/**
 * The shortlist the counter picks from while somebody is standing there (R-060).
 *
 * A single letter runs three unindexed substring scans over the whole customer
 * table and returns ten arbitrary people, which is neither useful at the counter
 * nor cheap on Purim morning. Two characters is the shortest search anyone
 * actually means.
 */
export async function lookupCustomersForCounter(query: string): Promise<Customer[]> {
  const where = query.trim().length < COUNTER_MIN_QUERY ? undefined : customerSearchWhere(query);
  if (!where) return [];

  return db.customer.findMany({ where, orderBy: { fullName: 'asc' }, take: COUNTER_MATCH_LIMIT });
}

const COUNTER_MIN_QUERY = 2;
const COUNTER_MATCH_LIMIT = 10;

const counterCustomerSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter the customer’s name.').max(120),
  email: z.email('Enter an email address the receipt can go to.'),
  phone: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .refine((value) => value === null || normalizePhone(value) !== null, {
      message: 'Enter a 10-digit US phone number, or leave it blank.',
    }),
});

export type CounterCustomerInput = z.input<typeof counterCustomerSchema>;

/**
 * The counter's "who is this?" (R-060).
 *
 * An email or a phone number that has ordered before is the same household, not
 * a new one — a duplicate customer is how a family loses last season's address
 * book and greetings. A returning customer's blank fields are filled in, but
 * nothing already on the record is overwritten from a queue: the person at the
 * counter is reading a name off a cheque, not doing data entry.
 */
export async function findOrCreateCustomerAtCounter(
  actor: AuditActor,
  input: CounterCustomerInput,
): Promise<Result<{ customer: Customer; created: boolean }>> {
  const parsed = counterCustomerSchema.safeParse(input);
  if (!parsed.success) return failure(INVALID_CUSTOMER_INPUT, parsed.error.issues[0].message);

  const normalizedEmail = normalizeEmail(parsed.data.email);
  const normalizedPhone = parsed.data.phone === null ? null : normalizePhone(parsed.data.phone);

  const existing =
    (await db.customer.findUnique({ where: { normalizedEmail } })) ??
    (normalizedPhone ? await db.customer.findUnique({ where: { normalizedPhone } }) : null);

  if (existing) return ok({ customer: await fillBlanks(existing, parsed.data), created: false });

  try {
    const customer = await db.customer.create({
      data: {
        email: parsed.data.email.trim(),
        normalizedEmail,
        fullName: parsed.data.fullName,
        ...(normalizedPhone ? { phone: parsed.data.phone, normalizedPhone } : {}),
      },
    });

    await recordAudit(actor, {
      action: 'customer.created_at_counter',
      entityType: 'Customer',
      entityId: customer.id,
      detail: { email: customer.email },
    });

    return ok({ customer, created: true });
  } catch (error) {
    const isDuplicate =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
    if (!isDuplicate) throw error;

    // Two tills ringing up the same walk-in at once: the loser reads the row the
    // winner just wrote rather than telling staff to try again.
    const winner = await db.customer.findUnique({ where: { normalizedEmail } });
    if (!winner) return failure(DUPLICATE_CUSTOMER_PHONE, DUPLICATE_PHONE_MESSAGE);
    return ok({ customer: winner, created: false });
  }
}

async function fillBlanks(
  customer: Customer,
  input: { fullName: string; phone: string | null },
): Promise<Customer> {
  const normalizedPhone = input.phone === null ? null : normalizePhone(input.phone);
  const addPhone = customer.normalizedPhone === null && normalizedPhone !== null;
  if (!addPhone) return customer;

  const taken = await db.customer.findUnique({ where: { normalizedPhone } });
  if (taken) return customer;

  return db.customer.update({
    where: { id: customer.id },
    data: { phone: input.phone, normalizedPhone },
  });
}

export const INVALID_CUSTOMER_INPUT = 'invalid_customer_input';
export const DUPLICATE_CUSTOMER_PHONE = 'duplicate_customer_phone';

/**
 * The phone number is unique so a POS entry cannot split one household into two
 * customers (R-144). Saying which record holds it would leak it.
 */
const DUPLICATE_PHONE_MESSAGE =
  'That phone number is already on another account. Call the office and we will merge them.';

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
    return failure(DUPLICATE_CUSTOMER_PHONE, DUPLICATE_PHONE_MESSAGE);
  }
}
