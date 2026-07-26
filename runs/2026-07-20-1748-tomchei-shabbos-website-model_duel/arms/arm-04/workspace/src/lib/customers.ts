import 'server-only';

import { Prisma, type Customer } from '@prisma/client';

import { db } from './db';
import { normalizeEmail } from './core/normalize';
import type { ExternalIdentity } from './auth/identity';

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
