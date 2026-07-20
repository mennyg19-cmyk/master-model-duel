import {
  OrderStatus,
  PrismaClient,
  ProductKind,
  SeasonStatus,
  StaffRole,
  StaffStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

async function seed() {
  await prisma.appSetting.upsert({
    where: { key: "organization" },
    update: {},
    create: {
      key: "organization",
      value: {
        name: "Tomchei Shabbos",
        timezone: "America/New_York",
      },
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "delivery-zips" },
    update: {},
    create: {
      key: "delivery-zips",
      value: ["08701", "08723", "08527"],
    },
  });

  const season = await prisma.season.upsert({
    where: { year: 2027 },
    update: {},
    create: {
      name: "Purim 2027",
      year: 2027,
      status: SeasonStatus.OPEN,
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "current-season-id" },
    update: { value: season.id },
    create: {
      key: "current-season-id",
      value: season.id,
    },
  });

  const packageProduct = await prisma.product.upsert({
    where: {
      seasonId_sku: { seasonId: season.id, sku: "JOY-BOX" },
    },
    update: {},
    create: {
      seasonId: season.id,
      sku: "JOY-BOX",
      name: "Purim Joy Box",
      description: "A finished mishloach manos package.",
      category: "Signature",
      kind: ProductKind.PACKAGE,
      priceCents: 5400,
      widthMm: 300,
      heightMm: 120,
      depthMm: 220,
      weightGrams: 1800,
      isFinishedPackage: true,
    },
  });

  await prisma.productOption.upsert({
    where: {
      productId_name_value: {
        productId: packageProduct.id,
        name: "Size",
        value: "Classic",
      },
    },
    update: {},
    create: {
      productId: packageProduct.id,
      name: "Size",
      value: "Classic",
      isDefault: true,
    },
  });

  await prisma.productOption.upsert({
    where: {
      productId_name_value: {
        productId: packageProduct.id,
        name: "Size",
        value: "Grand",
      },
    },
    update: {},
    create: {
      productId: packageProduct.id,
      name: "Size",
      value: "Grand",
      priceAdjustmentCents: 1800,
    },
  });

  const celebrationProduct = await prisma.product.upsert({
    where: {
      seasonId_sku: { seasonId: season.id, sku: "CELEBRATE-BOX" },
    },
    update: {},
    create: {
      seasonId: season.id,
      sku: "CELEBRATE-BOX",
      name: "The Celebration Box",
      description: "A bright collection of sweet and savory favorites for a joyful Purim.",
      category: "Celebration",
      kind: ProductKind.PACKAGE,
      priceCents: 7200,
      isFinishedPackage: true,
    },
  });

  const petiteProduct = await prisma.product.upsert({
    where: {
      seasonId_sku: { seasonId: season.id, sku: "PETITE-JOY" },
    },
    update: {},
    create: {
      seasonId: season.id,
      sku: "PETITE-JOY",
      name: "Petite Joy",
      description: "A compact Purim treat with all the warmth of our signature collection.",
      category: "Under $50",
      kind: ProductKind.PACKAGE,
      priceCents: 3600,
      isFinishedPackage: true,
    },
  });

  const addOn = await prisma.product.upsert({
    where: {
      seasonId_sku: { seasonId: season.id, sku: "ADD-CHOC" },
    },
    update: {},
    create: {
      seasonId: season.id,
      sku: "ADD-CHOC",
      name: "Chocolate Add-on",
      kind: ProductKind.ADD_ON,
      priceCents: 900,
    },
  });

  await prisma.productAllowedAddOn.upsert({
    where: {
      productId_addOnId: { productId: packageProduct.id, addOnId: addOn.id },
    },
    update: {},
    create: { productId: packageProduct.id, addOnId: addOn.id },
  });

  await prisma.inventoryItem.upsert({
    where: { productId: packageProduct.id },
    update: {},
    create: {
      targetKind: "PRODUCT",
      productId: packageProduct.id,
      onHand: 100,
    },
  });

  await prisma.inventoryItem.upsert({
    where: { productId: celebrationProduct.id },
    update: {},
    create: {
      targetKind: "PRODUCT",
      productId: celebrationProduct.id,
      onHand: 40,
    },
  });

  await prisma.inventoryItem.upsert({
    where: { productId: petiteProduct.id },
    update: {},
    create: {
      targetKind: "PRODUCT",
      productId: petiteProduct.id,
      onHand: 0,
    },
  });

  await prisma.inventoryItem.upsert({
    where: { addOnId: addOn.id },
    update: {},
    create: {
      targetKind: "ADD_ON",
      addOnId: addOn.id,
      onHand: 100,
    },
  });

  await prisma.fulfillmentMethod.upsert({
    where: {
      seasonId_code: { seasonId: season.id, code: "DELIVERY" },
    },
    update: {},
    create: {
      seasonId: season.id,
      code: "DELIVERY",
      displayName: "Local delivery",
    },
  });

  await prisma.packageType.upsert({
    where: {
      seasonId_name: { seasonId: season.id, name: "Standard gift carton" },
    },
    update: {},
    create: {
      seasonId: season.id,
      name: "Standard gift carton",
      innerWidthMm: 320,
      innerHeightMm: 150,
      innerDepthMm: 240,
      maxWeightGrams: 3000,
    },
  });

  await prisma.pickupLocation.upsert({
    where: {
      seasonId_name: { seasonId: season.id, name: "Tomchei Shabbos Center" },
    },
    update: {},
    create: {
      seasonId: season.id,
      name: "Tomchei Shabbos Center",
      address: {
        line1: "1 Community Way",
        city: "Lakewood",
        region: "NJ",
        postalCode: "08701",
      },
      instructions: "Use the side entrance.",
    },
  });

  const archivedSeason = await prisma.season.upsert({
    where: { year: 2026 },
    update: { status: SeasonStatus.CLOSED },
    create: {
      name: "Purim 2026",
      year: 2026,
      status: SeasonStatus.CLOSED,
    },
  });

  await prisma.product.upsert({
    where: {
      seasonId_sku: { seasonId: archivedSeason.id, sku: "2026-CLASSIC" },
    },
    update: {},
    create: {
      seasonId: archivedSeason.id,
      sku: "2026-CLASSIC",
      name: "The 2026 Classic",
      description: "A favorite from the 2026 Purim collection.",
      category: "Archive",
      kind: ProductKind.PACKAGE,
      priceCents: 5000,
      tracksInventory: false,
      isFinishedPackage: true,
    },
  });

  const customer = await prisma.customer.upsert({
    where: { emailNormalized: "seed.customer@example.test" },
    update: {},
    create: {
      displayName: "Seed Customer",
      email: "seed.customer@example.test",
      emailNormalized: "seed.customer@example.test",
      phone: "(732) 555-0100",
      phoneNormalized: "+17325550100",
    },
  });

  await prisma.customerAddress.upsert({
    where: {
      customerId_normalizedKey: {
        customerId: customer.id,
        normalizedKey: "10-main-st|lakewood|nj|08701|us",
      },
    },
    update: {},
    create: {
      customerId: customer.id,
      label: "Home",
      recipientName: "Seed Customer",
      line1: "10 Main St",
      city: "Lakewood",
      region: "NJ",
      postalCode: "08701",
      normalizedKey: "10-main-st|lakewood|nj|08701|us",
    },
  });

  await prisma.order.upsert({
    where: { draftReference: "D-00000001" },
    update: {},
    create: {
      seasonId: season.id,
      customerId: customer.id,
      status: OrderStatus.DRAFT,
      draftReference: "D-00000001",
      subtotalCents: packageProduct.priceCents,
      totalCents: packageProduct.priceCents,
      lines: {
        create: {
          productId: packageProduct.id,
          productNameSnapshot: packageProduct.name,
          skuSnapshot: packageProduct.sku,
          unitPriceCentsSnapshot: packageProduct.priceCents,
          quantity: 1,
        },
      },
    },
  });

  if (process.env.SEED_DEMO_STAFF === "true") {
    await prisma.staffUser.upsert({
      where: { email: "manager@example.test" },
      update: {},
      create: {
        clerkUserId: "seed_manager",
        email: "manager@example.test",
        displayName: "Demo Manager",
        role: StaffRole.MANAGER,
        status: StaffStatus.ACTIVE,
        confirmedAt: new Date(),
      },
    });
  }
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
