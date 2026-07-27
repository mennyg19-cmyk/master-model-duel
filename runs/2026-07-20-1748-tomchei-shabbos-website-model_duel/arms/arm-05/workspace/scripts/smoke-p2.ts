import { PrismaClient } from "@prisma/client";
import { LOCAL_DATABASE_URL, runWithLocalDatabase } from "./local-db";

async function verifySeededDomain() {
  const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_DATABASE_URL } } });
  try {
    const [seededSeason, seededProduct, seededCustomer, seededOrder] = await Promise.all([
      prisma.season.findUnique({ where: { year: 2026 } }),
      prisma.product.findFirst({ where: { sku: "PURIM-BOX-01" } }),
      prisma.customer.findUnique({ where: { emailNormalized: "seed@example.test" } }),
      prisma.order.findUnique({ where: { draftReference: "DRAFT-SEED-2026" } }),
    ]);
    if (!seededSeason || !seededProduct || !seededCustomer || !seededOrder) {
      throw new Error("P2 seed did not create the required season, product, customer, and order fixtures.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function runSmoke() {
  await runWithLocalDatabase("prisma", ["migrate", "deploy"]);
  await runWithLocalDatabase("prisma", ["generate"]);
  await runWithLocalDatabase("tsx", ["prisma/seed.ts"]);
  await verifySeededDomain();
  await runWithLocalDatabase("tsx", ["--test", "tests/domain-core.test.ts"]);
  console.log("S1 migrations and seed passed.");
  console.log("S2 grouping engine passed.");
  console.log("S3 order state machine passed.");
  console.log("S4 concurrent order numbers passed.");
  console.log("S5 inventory reservation race passed.");
}

void runSmoke().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
