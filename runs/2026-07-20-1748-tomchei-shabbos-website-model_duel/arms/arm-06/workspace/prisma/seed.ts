import { PrismaClient } from "@prisma/client";
import { BRAND } from "../lib/brand";

// Baseline seed (R-142): non-identity data only. Staff accounts are NOT
// seeded — the first-run setup page bootstraps the first manager on an empty
// staff table, and staff accounts are created through the admin UI.
const prisma = new PrismaClient();

async function main() {
  await prisma.setting.upsert({
    where: { key: "brand.name" },
    update: { value: BRAND.orgName },
    create: { key: "brand.name", value: BRAND.orgName },
  });

  const customer = await prisma.customer.upsert({
    where: { email: "demo.customer@example.org" },
    update: {},
    create: {
      email: "demo.customer@example.org",
      name: "Demo Customer",
      clerkUserId: "dev_clerk_customer_demo",
    },
  });

  console.log(`Seed complete: settings + 1 demo customer (${customer.email}). No staff seeded.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
