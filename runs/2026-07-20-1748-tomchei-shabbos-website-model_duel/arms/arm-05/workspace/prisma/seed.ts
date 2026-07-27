import { prisma } from "../lib/db";

async function seed() {
  await prisma.appSetting.upsert({
    where: { key: "foundation.seeded" },
    create: { key: "foundation.seeded", value: { version: 1 } },
    update: { value: { version: 1 } },
  });

  const season = await prisma.season.upsert({
    where: { year: 2026 },
    create: { name: "Purim 2026", year: 2026, status: "OPEN" },
    update: { name: "Purim 2026", status: "OPEN" },
  });
  const product = await prisma.product.upsert({
    where: { seasonId_sku: { seasonId: season.id, sku: "PURIM-BOX-01" } },
    create: {
      seasonId: season.id,
      sku: "PURIM-BOX-01",
      name: "Classic Mishloach Manos",
      kind: "PACKAGE",
      priceCents: 3600,
    },
    update: { name: "Classic Mishloach Manos", priceCents: 3600 },
  });
  const customer = await prisma.customer.upsert({
    where: { emailNormalized: "seed@example.test" },
    create: {
      firstName: "Seed",
      lastName: "Customer",
      emailNormalized: "seed@example.test",
      phoneNormalized: "2125550100",
    },
    update: { firstName: "Seed", lastName: "Customer" },
  });
  await prisma.address.upsert({
    where: {
      customerId_normalizedAddress: {
        customerId: customer.id,
        normalizedAddress: "1 seed street|brooklyn|ny|11201|us",
      },
    },
    create: {
      customerId: customer.id,
      recipientName: "Seed Customer",
      line1: "1 Seed Street",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11201",
      normalizedAddress: "1 seed street|brooklyn|ny|11201|us",
    },
    update: { recipientName: "Seed Customer" },
  });
  await prisma.fulfillmentMethod.upsert({
    where: { code: "DELIVERY" },
    create: { code: "DELIVERY", name: "Local delivery" },
    update: { name: "Local delivery" },
  });
  await prisma.order.upsert({
    where: { draftReference: "DRAFT-SEED-2026" },
    create: {
      seasonId: season.id,
      customerId: customer.id,
      draftReference: "DRAFT-SEED-2026",
      wireFormat: { version: 1, lines: [] },
    },
    update: { customerId: customer.id },
  });
  await prisma.inventoryItem.upsert({
    where: { productId: product.id },
    create: { productId: product.id, quantityOnHand: 25 },
    update: { quantityOnHand: 25, quantityReserved: 0 },
  });
  console.log("P2 season, catalog, customer, order, and inventory seeded.");
}

void seed()
  .catch((error: unknown) => {
    console.error("Unable to seed the PostgreSQL database.", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
