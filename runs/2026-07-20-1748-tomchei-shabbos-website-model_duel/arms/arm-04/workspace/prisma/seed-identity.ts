import { db } from '../src/lib/db';
import { bootstrapFirstManager } from '../src/lib/bootstrap';
import { normalizeEmail } from '../src/lib/core/normalize';
import { normalizePhone } from '../src/lib/core/phone';

/**
 * Baseline identities. The first manager goes through the same bootstrap path
 * the setup page uses, so seeding cannot create an account the UI could not.
 */
const MANAGER = { email: 'manager@tomchei.example', fullName: 'Rivka Manager' };

const STAFF = [
  { email: 'staff@tomchei.example', fullName: 'Yossi Staff', role: 'STAFF' },
  { email: 'driver@tomchei.example', fullName: 'Dov Driver', role: 'DRIVER' },
] as const;

const CUSTOMERS = [
  { email: 'donor@example.com', fullName: 'Sara Donor', phone: '(555) 010-0100' },
  { email: 'friend@example.com', fullName: 'Chaim Friend', phone: null },
];

export async function seedIdentities(): Promise<{ primaryCustomerId: string }> {
  const bootstrap = await bootstrapFirstManager({
    email: MANAGER.email,
    fullName: MANAGER.fullName,
    externalAuthId: `local:${MANAGER.email}`,
  });

  console.log(
    bootstrap.ok
      ? `Created first manager ${MANAGER.email}`
      : `First manager already exists (${bootstrap.publicMessage})`,
  );

  for (const person of STAFF) {
    await db.staffUser.upsert({
      where: { email: person.email },
      create: {
        email: person.email,
        fullName: person.fullName,
        externalAuthId: `local:${person.email}`,
        role: person.role,
        status: 'ACTIVE',
        confirmedAt: new Date(),
      },
      update: { fullName: person.fullName, role: person.role, status: 'ACTIVE' },
    });
  }

  let primaryCustomerId = '';

  for (const customer of CUSTOMERS) {
    const normalizedEmail = normalizeEmail(customer.email);
    const normalizedPhone = customer.phone ? normalizePhone(customer.phone) : null;

    const row = await db.customer.upsert({
      where: { normalizedEmail },
      create: { ...customer, normalizedEmail, normalizedPhone },
      update: { fullName: customer.fullName, normalizedPhone },
    });

    primaryCustomerId ||= row.id;
  }

  return { primaryCustomerId };
}
