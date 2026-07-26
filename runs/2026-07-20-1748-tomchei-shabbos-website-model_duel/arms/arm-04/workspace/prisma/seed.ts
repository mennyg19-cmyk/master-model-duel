import { PrismaClient } from '@prisma/client';

import { bootstrapFirstManager } from '../src/lib/bootstrap';
import { normalizeEmail } from '../src/lib/core/normalize';

/**
 * Baseline identities for development and CI. Safe to re-run: every row is
 * matched on its natural key. The first manager goes through the same bootstrap
 * path the setup page uses, so seeding cannot create an account the UI could not.
 */
const db = new PrismaClient();

const MANAGER = { email: 'manager@tomchei.example', fullName: 'Rivka Manager' };
const STAFF = { email: 'staff@tomchei.example', fullName: 'Yossi Staff' };
const DRIVER = { email: 'driver@tomchei.example', fullName: 'Dov Driver' };

const CUSTOMERS = [
  { email: 'donor@example.com', fullName: 'Sara Donor', phone: '+15550100' },
  { email: 'friend@example.com', fullName: 'Chaim Friend', phone: null },
];

async function main() {
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

  for (const [person, role] of [
    [STAFF, 'STAFF'],
    [DRIVER, 'DRIVER'],
  ] as const) {
    await db.staffUser.upsert({
      where: { email: person.email },
      create: {
        email: person.email,
        fullName: person.fullName,
        externalAuthId: `local:${person.email}`,
        role,
        status: 'ACTIVE',
        confirmedAt: new Date(),
      },
      update: { fullName: person.fullName, role, status: 'ACTIVE' },
    });
  }

  for (const customer of CUSTOMERS) {
    const normalizedEmail = normalizeEmail(customer.email);
    await db.customer.upsert({
      where: { normalizedEmail },
      create: { ...customer, normalizedEmail },
      update: { fullName: customer.fullName },
    });
  }

  const [staffCount, customerCount] = await Promise.all([db.staffUser.count(), db.customer.count()]);
  console.log(`Seed complete: ${staffCount} staff, ${customerCount} customers`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
