import { PrismaClient } from "@prisma/client";
import { seedBaseline } from "../lib/testops/baseline-seed";

// Baseline seed (R-142): the domain body lives in lib/testops/baseline-seed.ts
// so the P12 test console seeds the exact same dataset. Staff accounts are NOT
// seeded — the first-run setup page bootstraps the first manager.
const prisma = new PrismaClient();

async function main() {
  const counts = await seedBaseline(prisma);
  console.log("Seed complete (settings, no staff). Domain counts:", JSON.stringify(counts));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
