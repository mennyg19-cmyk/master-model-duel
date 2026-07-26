import { db } from '../src/lib/db';

import { seedDomain } from './seed-domain';
import { seedIdentities } from './seed-identity';

/**
 * Baseline data for development and CI. Safe to re-run: every row is matched on
 * its natural key, and the demo order is created once.
 */
async function main() {
  const { primaryCustomerId } = await seedIdentities();
  await seedDomain(primaryCustomerId);

  const [staffCount, customerCount, productCount, orderCount, packageCount] = await Promise.all([
    db.staffUser.count(),
    db.customer.count(),
    db.product.count(),
    db.order.count(),
    db.package.count(),
  ]);

  console.log(
    `Seed complete: ${staffCount} staff, ${customerCount} customers, ${productCount} products, ` +
      `${orderCount} orders, ${packageCount} packages`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
