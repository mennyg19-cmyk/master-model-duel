import { PrismaClient } from "@prisma/client";
import { findOrLinkCustomer } from "../lib/customers";
import { finalizeOrder } from "../lib/domain/finalize";
import { newDraftReference, wireFormat } from "../lib/domain/draft-reference";

const db = new PrismaClient();

// Baseline seed (R-142): reference data only. Staff accounts are created through
// the first-run setup page so the bootstrap lockout stays testable on a fresh DB.
async function main() {
  await db.setting.upsert({
    where: { key: "org.display_name" },
    update: {},
    create: { key: "org.display_name", value: "Tomchei Shabbos Mishloach Manos" },
  });

  await db.concurrencyFixture.upsert({
    where: { name: "smoke-counter" },
    update: {},
    create: { name: "smoke-counter" },
  });

  const customer = await findOrLinkCustomer({
    email: "sample.customer@example.com",
    name: "Sample Customer",
  });
  // Second call with an auth id must link, not duplicate (customer identity linking).
  const linked = await findOrLinkCustomer({
    email: "sample.customer@example.com",
    name: "Sample Customer",
    authUserId: "seed_auth_identity_1",
  });
  if (customer.id !== linked.id) {
    throw new Error("Customer identity linking failed: seed created a duplicate customer");
  }

  await seedDomainCore(linked.id);

  const counts = {
    settings: await db.setting.count(),
    customers: await db.customer.count(),
    fixtures: await db.concurrencyFixture.count(),
    seasons: await db.season.count(),
    products: await db.product.count(),
    orders: await db.order.count(),
    packages: await db.package.count(),
  };
  console.log("Seed complete:", counts);
}

// P2 seed: one open season with a small catalog, and one finalized order so
// the grouping engine, order numbering, and package audit all run end to end.
async function seedDomainCore(customerId: string) {
  const season = await db.season.upsert({
    where: { name: "Purim 2026" },
    update: {},
    create: { name: "Purim 2026", status: "OPEN" },
  });

  const delivery = await db.fulfillmentMethod.upsert({
    where: { code: "local_delivery" },
    update: {},
    create: { code: "local_delivery", name: "Local Delivery", sortOrder: 1 },
  });
  await db.fulfillmentMethod.upsert({
    where: { code: "pickup" },
    update: {},
    create: { code: "pickup", name: "Pickup", sortOrder: 2 },
  });

  const classicBasket = await db.product.upsert({
    where: { seasonId_slug: { seasonId: season.id, slug: "classic-basket" } },
    update: {},
    create: {
      seasonId: season.id,
      name: "Classic Basket",
      slug: "classic-basket",
      basePriceCents: 3600,
      widthCm: 30,
      lengthCm: 30,
      heightCm: 25,
      weightGrams: 1500,
      trackInventory: true,
      options: {
        create: { name: "Wine upgrade", priceAdjustmentCents: 1800 },
      },
    },
  });

  const wineAddOn = await db.addOn.upsert({
    where: { seasonId_name: { seasonId: season.id, name: "Extra hamantaschen" } },
    update: {},
    create: {
      seasonId: season.id,
      name: "Extra hamantaschen",
      priceCents: 500,
      trackInventory: true,
      restrictions: { create: { productId: classicBasket.id } },
    },
  });

  await db.inventoryItem.upsert({
    where: { productId: classicBasket.id },
    update: {},
    create: { productId: classicBasket.id, quantityOnHand: 100 },
  });
  await db.inventoryItem.upsert({
    where: { addOnId: wineAddOn.id },
    update: {},
    create: { addOnId: wineAddOn.id, quantityOnHand: 200 },
  });

  const existingOrder = await db.order.findFirst({ where: { seasonId: season.id } });
  if (existingOrder) return;

  const order = await db.order.create({
    data: {
      seasonId: season.id,
      customerId,
      draftReference: newDraftReference(),
      totalCents: 7200,
      lines: {
        create: [1, 2].map(() => ({
          productId: classicBasket.id,
          unitPriceCents: 3600,
          recipientName: "Rivka Friedman",
          addressLine1: "12 Main St",
          city: "Lakewood",
          state: "NJ",
          zip: "08701",
          fulfillmentMethodId: delivery.id,
          greeting: "A freilichen Purim!",
        })),
      },
    },
  });
  const finalized = await finalizeOrder(order.id);
  console.log(
    `Seed order ${finalized.draftReference} finalized as #${finalized.orderNumber} (wire: ${wireFormat(finalized.draftReference)})`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
