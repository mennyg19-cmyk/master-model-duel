import { PrismaClient } from "@prisma/client";
import { BRAND } from "../lib/brand";
import { findOrCreateCustomer } from "../lib/customers/dedupe";
import { createDraftOrder } from "../lib/orders/create-draft";

// Baseline seed (R-142): non-identity data only. Staff accounts are NOT
// seeded — the first-run setup page bootstraps the first manager on an empty
// staff table, and staff accounts are created through the admin UI.
// P2: season + catalog + customer + draft order for smoke S1. Idempotent:
// every row upserts on a stable unique key.
const prisma = new PrismaClient();

async function main() {
  await prisma.setting.upsert({
    where: { key: "brand.name" },
    update: { value: BRAND.orgName },
    create: { key: "brand.name", value: BRAND.orgName },
  });

  const season = await prisma.season.upsert({
    where: { name: "2026" },
    update: {},
    create: { name: "2026", status: "OPEN" },
  });

  // Catalog: one finished-good package with a priced size option, one
  // restricted add-on, both inventory-tracked.
  const classic = await prisma.product.upsert({
    where: { slug: "classic-mishloach-manos" },
    update: {},
    create: {
      slug: "classic-mishloach-manos",
      name: "Classic Mishloach Manos",
      kind: "GOOD",
      basePriceCents: 3600,
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
      weightGrams: 900,
      trackInventory: true,
    },
  });
  const sizeOption = await prisma.productOption.upsert({
    where: { productId_name: { productId: classic.id, name: "Size" } },
    update: {},
    create: { productId: classic.id, name: "Size" },
  });
  const standard = await prisma.productOptionValue.upsert({
    where: { optionId_label: { optionId: sizeOption.id, label: "Standard" } },
    update: {},
    create: { optionId: sizeOption.id, label: "Standard", priceDeltaCents: 0 },
  });
  await prisma.productOptionValue.upsert({
    where: { optionId_label: { optionId: sizeOption.id, label: "Deluxe" } },
    update: {},
    create: { optionId: sizeOption.id, label: "Deluxe", priceDeltaCents: 1200 },
  });

  const grapeJuice = await prisma.addOn.upsert({
    where: { slug: "grape-juice-bottle" },
    update: {},
    create: { slug: "grape-juice-bottle", name: "Bottle of Grape Juice", priceCents: 800 },
  });
  await prisma.productAddOn.upsert({
    where: { productId_addOnId: { productId: classic.id, addOnId: grapeJuice.id } },
    update: {},
    create: { productId: classic.id, addOnId: grapeJuice.id },
  });

  await prisma.inventoryItem.upsert({
    where: { productId: classic.id },
    update: {},
    create: { productId: classic.id, onHand: 50, reserved: 0 },
  });
  await prisma.inventoryItem.upsert({
    where: { addOnId: grapeJuice.id },
    update: {},
    create: { addOnId: grapeJuice.id, onHand: 100, reserved: 0 },
  });

  // Data-driven fulfillment methods (R-153/R-154).
  await prisma.fulfillmentMethod.upsert({
    where: { code: "DELIVERY" },
    update: {},
    create: {
      code: "DELIVERY",
      label: "Delivery",
      stages: ["NEW", "PRINTED", "PACKED", "SENT"],
      terminalStage: "SENT",
    },
  });
  await prisma.fulfillmentMethod.upsert({
    where: { code: "PICKUP" },
    update: {},
    create: {
      code: "PICKUP",
      label: "Pickup",
      stages: ["NEW", "PACKED", "PICKED_UP"],
      terminalStage: "PICKED_UP",
    },
  });

  await prisma.pickupLocation.upsert({
    where: { id: "seed-pickup-main-shul" },
    update: {},
    create: {
      id: "seed-pickup-main-shul",
      name: "Main Shul Lobby",
      line1: "1 Torah Way",
      city: "Lakewood",
      region: "NJ",
      postalCode: "08701",
    },
  });

  await prisma.packageType.upsert({
    where: { name: "Standard Box" },
    update: {},
    create: { name: "Standard Box", lengthMm: 320, widthMm: 220, heightMm: 120, maxWeightGrams: 3000 },
  });
  await prisma.shipmentBox.upsert({
    where: { name: "Shipper S" },
    update: {},
    create: { name: "Shipper S", lengthMm: 340, widthMm: 240, heightMm: 140, tareWeightGrams: 180 },
  });

  // Customer (through the dedupe engine, R-144) + saved address (R-145).
  const { customer } = await findOrCreateCustomer({
    name: "Demo Customer",
    email: "demo.customer@example.org",
    phone: "(732) 555-0142",
  });
  await prisma.address.upsert({
    where: { customerId_label: { customerId: customer.id, label: "Home" } },
    update: {},
    create: {
      customerId: customer.id,
      label: "Home",
      line1: "12 Elm Street",
      city: "Lakewood",
      region: "NJ",
      postalCode: "08701",
    },
  });

  // Draft order with engine-side price snapshots (R-149/R-150) + draft ref
  // (R-047). count-then-create diverges from the upsert discipline on purpose:
  // a draft order has no natural unique key, so there is nothing to upsert on —
  // the count probe only keeps reseeds from piling up demo orders.
  const existingOrder = await prisma.order.count({ where: { seasonId: season.id, customerId: customer.id } });
  if (existingOrder === 0) {
    await createDraftOrder({
      seasonId: season.id,
      customerId: customer.id,
      lines: [
        {
          productId: classic.id,
          optionValueId: standard.id,
          qty: 1,
        },
      ],
    });
  }

  const counts = {
    seasons: await prisma.season.count(),
    products: await prisma.product.count(),
    addOns: await prisma.addOn.count(),
    customers: await prisma.customer.count(),
    orders: await prisma.order.count(),
    fulfillmentMethods: await prisma.fulfillmentMethod.count(),
  };
  console.log("Seed complete (settings, no staff). Domain counts:", JSON.stringify(counts));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
