import { PrismaClient } from "@prisma/client";
import { findOrLinkCustomer } from "../lib/customers";
import { finalizeOrder } from "../lib/domain/finalize";
import { newDraftReference, wireFormat } from "../lib/domain/draft-reference";
import { hashPassword } from "../lib/auth/passwords";
import { normalizedAddressKey } from "../lib/addresses/normalize";

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

  // P4: dev-mode sign-in credential + one saved recipient so the account area
  // and builder address book have data on a fresh DB.
  await db.customer.update({
    where: { id: linked.id },
    data: { passwordHash: hashPassword("customer-demo-1234") },
  });
  const seededAddress = {
    recipient: "Rivka Friedman",
    line1: "12 Main St",
    city: "Lakewood",
    state: "NJ",
    zip: "08701",
  };
  await db.customerAddress.upsert({
    where: {
      customerId_normalizedKey: {
        customerId: linked.id,
        normalizedKey: normalizedAddressKey(seededAddress),
      },
    },
    update: {},
    create: { customerId: linked.id, normalizedKey: normalizedAddressKey(seededAddress), ...seededAddress },
  });

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
    update: { kind: "BULK_DELIVERY" },
    create: { code: "local_delivery", name: "Local Delivery", kind: "BULK_DELIVERY", sortOrder: 1 },
  });
  await db.fulfillmentMethod.upsert({
    where: { code: "per_package_delivery" },
    update: { kind: "PER_PACKAGE_DELIVERY" },
    create: {
      code: "per_package_delivery",
      name: "Purim-Day Delivery",
      kind: "PER_PACKAGE_DELIVERY",
      sortOrder: 2,
    },
  });
  await db.fulfillmentMethod.upsert({
    where: { code: "pickup" },
    update: { kind: "PICKUP" },
    create: { code: "pickup", name: "Pickup", kind: "PICKUP", sortOrder: 3 },
  });
  await db.fulfillmentMethod.upsert({
    where: { code: "shipping" },
    update: { kind: "SHIPPING" },
    create: { code: "shipping", name: "Shipping", kind: "SHIPPING", sortOrder: 4 },
  });

  // P8: shipment boxes the bin-packer plans carrier parcels against (R-081).
  const shipmentBoxes = [
    { name: "Small shipper", lengthCm: 35, widthCm: 35, heightCm: 30, weightGrams: 250 },
    { name: "Medium shipper", lengthCm: 45, widthCm: 45, heightCm: 40, weightGrams: 400 },
    { name: "Large shipper", lengthCm: 60, widthCm: 50, heightCm: 45, weightGrams: 600 },
  ];
  for (const box of shipmentBoxes) {
    await db.shipmentBox.upsert({ where: { name: box.name }, update: {}, create: box });
  }

  const classicBasket = await db.product.upsert({
    where: { seasonId_slug: { seasonId: season.id, slug: "classic-basket" } },
    update: { category: "Baskets" },
    create: {
      seasonId: season.id,
      name: "Classic Basket",
      slug: "classic-basket",
      category: "Baskets",
      description: "Our signature basket: wine, hamantaschen, fruit, and chocolates.",
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

  await seedStorefrontCatalog(season.id);

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

// P3 seed: categories + a sold-out product for the storefront, and one closed
// past season so the archive has something to browse.
async function seedStorefrontCatalog(currentSeasonId: string) {
  const catalog: {
    slug: string;
    name: string;
    category: string;
    description: string;
    basePriceCents: number;
    trackInventory?: boolean;
    soldOut?: boolean;
  }[] = [
    { slug: "deluxe-basket", name: "Deluxe Basket", category: "Baskets", description: "The Classic, upgraded: premium wine, artisan chocolate, and a keepsake tray.", basePriceCents: 7200 },
    { slug: "wine-duo", name: "Wine Duo", category: "Wine", description: "Two bottles of kosher wine in a gift sleeve.", basePriceCents: 5400 },
    { slug: "kids-treat-box", name: "Kids Treat Box", category: "Kids", description: "Nosh, groggers, and a Purim mask — sized for little hands.", basePriceCents: 1800 },
    { slug: "executive-basket", name: "Executive Basket", category: "Baskets", description: "Our largest arrangement. Limited quantity each season.", basePriceCents: 12000, trackInventory: true, soldOut: true },
  ];

  for (const item of catalog) {
    const product = await db.product.upsert({
      where: { seasonId_slug: { seasonId: currentSeasonId, slug: item.slug } },
      update: {},
      create: {
        seasonId: currentSeasonId,
        name: item.name,
        slug: item.slug,
        category: item.category,
        description: item.description,
        basePriceCents: item.basePriceCents,
        trackInventory: item.trackInventory ?? false,
      },
    });
    if (item.trackInventory) {
      await db.inventoryItem.upsert({
        where: { productId: product.id },
        update: {},
        create: { productId: product.id, quantityOnHand: item.soldOut ? 0 : 50 },
      });
    }
  }

  const pastSeason = await db.season.upsert({
    where: { name: "Purim 2025" },
    update: {},
    create: { name: "Purim 2025", status: "CLOSED" },
  });
  const pastCatalog = [
    { slug: "classic-basket-2025", name: "Classic Basket 2025", category: "Baskets", basePriceCents: 3400 },
    { slug: "purim-wine-box", name: "Purim Wine Box", category: "Wine", basePriceCents: 5000 },
  ];
  for (const item of pastCatalog) {
    await db.product.upsert({
      where: { seasonId_slug: { seasonId: pastSeason.id, slug: item.slug } },
      update: {},
      create: { seasonId: pastSeason.id, ...item, description: "From the 2025 collection." },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
