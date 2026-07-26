import { db } from '../src/lib/db';

import { seedDomain } from './seed-domain';
import { seedIdentities } from './seed-identity';
import { seedStorefront } from './seed-storefront';

/**
 * Baseline data for development and CI. Safe to re-run: every row is matched on
 * its natural key, and the demo order is created once.
 */
async function main() {
  const { primaryCustomerId } = await seedIdentities();
  const { season } = await seedDomain(primaryCustomerId);
  await seedStorefront(season);

  const [staffCount, customerCount, productCount, orderCount, packageCount, subscriberCount] =
    await Promise.all([
      db.staffUser.count(),
      db.customer.count(),
      db.product.count(),
      db.order.count(),
      db.package.count(),
      db.newsletterSubscriber.count(),
    ]);

  console.log(
    `Seed complete: ${staffCount} staff, ${customerCount} customers, ${productCount} products, ` +
      `${orderCount} orders, ${packageCount} packages, ${subscriberCount} subscribers`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
