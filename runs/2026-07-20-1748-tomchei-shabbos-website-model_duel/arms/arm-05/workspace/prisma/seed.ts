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
  await prisma.productOption.upsert({
    where: { productId_name_value: { productId: product.id, name: "Presentation", value: "Classic ribbon" } },
    create: { productId: product.id, name: "Presentation", value: "Classic ribbon", priceAdjustmentCents: 0 },
    update: { priceAdjustmentCents: 0 },
  });
  const premiumProduct = await prisma.product.upsert({
    where: { seasonId_sku: { seasonId: season.id, sku: "PURIM-BOX-02" } },
    create: {
      seasonId: season.id,
      sku: "PURIM-BOX-02",
      name: "Community Celebration Box",
      description: "A larger collection for sharing with family, friends, or a whole office.",
      kind: "PACKAGE",
      priceCents: 5400,
    },
    update: { name: "Community Celebration Box", priceCents: 5400 },
  });
  await prisma.inventoryItem.upsert({
    where: { productId: premiumProduct.id },
    create: { productId: premiumProduct.id, quantityOnHand: 0 },
    update: { quantityOnHand: 0, quantityReserved: 0 },
  });
  const archivedSeason = await prisma.season.upsert({
    where: { year: 2025 },
    create: { name: "Purim 2025", year: 2025, status: "CLOSED" },
    update: { name: "Purim 2025", status: "CLOSED" },
  });
  await prisma.product.upsert({
    where: { seasonId_sku: { seasonId: archivedSeason.id, sku: "PURIM-BOX-2025" } },
    create: {
      seasonId: archivedSeason.id,
      sku: "PURIM-BOX-2025",
      name: "Purim 2025 Keepsake Box",
      description: "A past collection shown for inspiration only.",
      kind: "PACKAGE",
      priceCents: 4200,
    },
    update: { name: "Purim 2025 Keepsake Box" },
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
  const celebrationProduct = await prisma.product.upsert({
    where: { seasonId_sku: { seasonId: season.id, sku: "PURIM-BOX-03" } },
    create: {
      seasonId: season.id,
      sku: "PURIM-BOX-03",
      name: "Neighborhood Joy Box",
      kind: "PACKAGE",
      priceCents: 4600,
    },
    update: { name: "Neighborhood Joy Box", priceCents: 4600 },
  });
  await prisma.inventoryItem.upsert({
    where: { productId: celebrationProduct.id },
    create: { productId: celebrationProduct.id, quantityOnHand: 25 },
    update: { quantityOnHand: 25, quantityReserved: 0 },
  });
  await prisma.customerIdentity.upsert({
    where: { clerkUserId: "customer-seed" },
    create: { clerkUserId: "customer-seed", email: "seed@example.test", customerId: customer.id },
    update: { email: "seed@example.test", customerId: customer.id },
  });
  await prisma.appSetting.upsert({
    where: { key: "delivery.zipCodes" },
    create: { key: "delivery.zipCodes", value: ["11201", "11205", "11211"] },
    update: { value: ["11201", "11205", "11211"] },
  });
  console.log("P3 seasons, storefront catalog, customer, order, and inventory seeded.");
}

void seed()
  .catch((error: unknown) => {
    console.error("Unable to seed the PostgreSQL database.", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
