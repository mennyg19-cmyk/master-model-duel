import { Customer, Prisma } from "@prisma/client";

// G-029's "never guess a merge" law, one home for every legacy handler:
// email and phone are both dedupe keys; when they point at DIFFERENT existing
// customers the row is ambiguous — a human merges the customers, the import
// refuses. Otherwise the match wins (byEmail first) or a new customer is
// created, with the deterministic synthetic email when only a phone survives.
export interface LegacyCustomerHead {
  email: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  customerName: string | null;
}

export interface LegacyCustomerMatches {
  byEmail: Map<string, Customer>;
  byPhone: Map<string, Customer>;
}

export function legacyPhoneEmail(normalizedPhone: string): string {
  return `legacy-phone-${normalizedPhone.replace(/\D/g, "")}@legacy.local`;
}

// One batched lookup for the whole commit instead of two findUnique calls per
// row inside the open transaction (ponytail § scale): every email/phone the
// batch mentions, fetched once, keyed both ways.
export async function findLegacyCustomerMatches(
  tx: Prisma.TransactionClient,
  heads: LegacyCustomerHead[],
): Promise<LegacyCustomerMatches> {
  const emails = [...new Set(heads.map((head) => head.email).filter((email): email is string => email !== null))];
  const phones = [
    ...new Set(heads.map((head) => head.normalizedPhone).filter((phone): phone is string => phone !== null)),
  ];
  const existing = await tx.customer.findMany({
    where: {
      OR: [
        ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
        ...(phones.length > 0 ? [{ normalizedPhone: { in: phones } }] : []),
      ],
    },
  });
  const byEmail = new Map(existing.map((customer) => [customer.email, customer]));
  const byPhone = new Map(
    existing
      .filter((customer) => customer.normalizedPhone !== null)
      .map((customer) => [customer.normalizedPhone!, customer]),
  );
  return { byEmail, byPhone };
}

export async function resolveLegacyCustomer(
  tx: Prisma.TransactionClient,
  head: LegacyCustomerHead,
  matches: LegacyCustomerMatches,
): Promise<{ customer: Customer; created: boolean } | { error: string }> {
  const byEmail = head.email ? (matches.byEmail.get(head.email) ?? null) : null;
  const byPhone = head.normalizedPhone ? (matches.byPhone.get(head.normalizedPhone) ?? null) : null;
  if (byEmail && byPhone && byEmail.id !== byPhone.id) {
    return { error: `email matches "${byEmail.name}" but phone matches "${byPhone.name}" — merge those customers first` };
  }
  const existing = byEmail ?? byPhone;
  if (existing) return { customer: existing, created: false };

  const email = head.email ?? legacyPhoneEmail(head.normalizedPhone ?? "unknown");
  const customer = await tx.customer.create({
    data: {
      email,
      name: head.customerName ?? email.split("@")[0],
      phone: head.phone,
      normalizedPhone: head.normalizedPhone,
    },
  });
  // Register the creation so a later row in this same batch (the multi-row
  // address book case) merges into it instead of colliding on the unique key.
  matches.byEmail.set(customer.email, customer);
  if (customer.normalizedPhone) matches.byPhone.set(customer.normalizedPhone, customer);
  return { customer, created: true };
}
