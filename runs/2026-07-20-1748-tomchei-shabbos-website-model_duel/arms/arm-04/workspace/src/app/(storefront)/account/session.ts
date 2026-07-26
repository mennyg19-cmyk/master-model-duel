import 'server-only';

import { redirect } from 'next/navigation';
import type { Customer } from '@prisma/client';

import { getCurrentCustomer } from '@/lib/customers';

/**
 * Staff areas answer 401 because a customer landing there is a mistake worth
 * naming. The account area is the opposite: not being signed in yet is the normal
 * state of a first-time customer, so the answer is the sign-in form and a way
 * back to the page they wanted.
 */
export async function requireSignedInCustomer(next: string): Promise<Customer> {
  const customer = await getCurrentCustomer();
  if (!customer) redirect(`/account/sign-in?next=${encodeURIComponent(next)}`);
  return customer;
}
