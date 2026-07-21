import {
  OrderStatus,
  PermissionEffect,
  ProductKind,
  SeasonStatus,
  StaffRole,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { getEnv } from "../src/lib/env";
import { SETUP_LOCK_KEY } from "../src/lib/constants";
import { formatDraftRef } from "../src/lib/orders/draft-wire";
import { buildGroupingKey } from "../src/lib/orders/grouping";
import { assertInventoryTargetXor } from "../src/lib/inventory/target-xor";
import { normalizeEmail } from "../src/lib/normalize";

async function main() {
  const env = getEnv();

  await db.versionedFixture.upsert({
    where: { label: "concurrency-fixture" },
    create: { label: "concurrency-fixture", payload: "seed", version: 1 },
    update: {},
  });

  const manager = await db.staffUser.upsert({
    where: { email: "manager@tomchei.local" },
    create: {
      email: "manager@tomchei.local",
      displayName: "Baseline Manager",
      role: StaffRole.MANAGER,
      clerkUserId: env.DEV_MANAGER_USER_ID ?? "dev_manager_1",
      confirmedAt: new Date(),
      isActive: true,
    },
    update: {
      clerkUserId: env.DEV_MANAGER_USER_ID ?? "dev_manager_1",
      isActive: true,
      revokedAt: null,
    },
  });

  const staff = await db.staffUser.upsert({
    where: { email: "staff@tomchei.local" },
    create: {
      email: "staff@tomchei.local",
      displayName: "Baseline Staff",
      role: StaffRole.STAFF,
      clerkUserId: env.DEV_STAFF_USER_ID ?? "dev_staff_1",
      confirmedAt: new Date(),
      isActive: true,
    },
    update: {
      clerkUserId: env.DEV_STAFF_USER_ID ?? "dev_staff_1",
      role: StaffRole.STAFF,
      isActive: true,
      revokedAt: null,
    },
  });

  await db.permissionOverride.deleteMany({ where: { staffUserId: staff.id } });
  await db.permissionOverride.create({
    data: {
      staffUserId: staff.id,
      permission: "staff.manage",
      effect: PermissionEffect.DENY,
    },
  });

  await db.staffUser.upsert({
    where: { email: "driver@tomchei.local" },
    create: {
      email: "driver@tomchei.local",
      displayName: "Baseline Driver",
      role: StaffRole.DRIVER,
      clerkUserId: env.DEV_DRIVER_USER_ID ?? "dev_driver_1",
      confirmedAt: new Date(),
      isActive: true,
    },
    update: {
      clerkUserId: env.DEV_DRIVER_USER_ID ?? "dev_driver_1",
      role: StaffRole.DRIVER,
      isActive: true,
      revokedAt: null,
    },
  });

  const customerEmail = normalizeEmail("customer@tomchei.local");
  const customer = await db.customer.upsert({
    where: { email: customerEmail },
    create: {
      email: customerEmail,
      emailNorm: customerEmail,
      displayName: "Baseline Customer",
      clerkUserId: env.DEV_CUSTOMER_USER_ID ?? "dev_customer_1",
      phone: "5551234567",
      phoneNorm: "15551234567",
    },
    update: {
      clerkUserId: env.DEV_CUSTOMER_USER_ID ?? "dev_customer_1",
      emailNorm: customerEmail,
    },
  });

  await db.savedAddress.upsert({
    where: { id: "seed-addr-customer-home" },
    create: {
      id: "seed-addr-customer-home",
      customerId: customer.id,
      label: "Home",
      recipientName: "Baseline Customer",
      line1: "100 Main St",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11218",
      country: "US",
      latitude: 40.635,
      longitude: -73.976,
      geocodeStatus: "ok",
      geocodedAt: new Date(),
      isDefault: true,
    },
    update: {
      customerId: customer.id,
      line1: "100 Main St",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11218",
    },
  });

  const season = await db.season.upsert({
    where: { slug: "purim-2026" },
    create: {
      slug: "purim-2026",
      name: "Purim 2026",
      year: 2026,
      status: SeasonStatus.OPEN,
      opensAt: new Date("2026-02-01T00:00:00Z"),
      closesAt: new Date("2026-03-20T00:00:00Z"),
      scheduledOpenAt: new Date("2026-02-01T00:00:00Z"),
      scheduledCloseAt: new Date("2026-03-20T00:00:00Z"),
      nextOrderNumber: 1,
    },
    update: {
      status: SeasonStatus.OPEN,
      name: "Purim 2026",
    },
  });

  const shipMethod = await db.fulfillmentMethod.upsert({
    where: { code: "SHIP" },
    create: {
      code: "SHIP",
      label: "Ship",
      description: "Carrier shipping",
      sortOrder: 1,
    },
    update: { isActive: true },
  });

  await db.fulfillmentMethod.upsert({
    where: { code: "PICKUP" },
    create: {
      code: "PICKUP",
      label: "Pickup",
      description: "Customer pickup",
      sortOrder: 2,
    },
    update: { isActive: true },
  });

  await db.fulfillmentMethod.upsert({
    where: { code: "DELIVERY" },
    create: {
      code: "DELIVERY",
      label: "Volunteer delivery",
      description: "Local volunteer route",
      sortOrder: 3,
    },
    update: { isActive: true },
  });

  const product = await db.product.upsert({
    where: { seasonId_sku: { seasonId: season.id, sku: "FAMILY-BOX" } },
    create: {
      seasonId: season.id,
      sku: "FAMILY-BOX",
      name: "Family Mishloach Manot",
      slug: "family-box",
      kind: ProductKind.PACKAGE,
      category: "Packages",
      description: "Seed catalog product",
      basePriceCents: 5400,
      weightOz: 48,
      lengthIn: 12,
      widthIn: 9,
      heightIn: 4,
      tracksInventory: true,
      sortOrder: 1,
    },
    update: {
      name: "Family Mishloach Manot",
      category: "Packages",
      basePriceCents: 5400,
      isActive: true,
    },
  });

  const soldOut = await db.product.upsert({
    where: { seasonId_sku: { seasonId: season.id, sku: "LIMITED-BOX" } },
    create: {
      seasonId: season.id,
      sku: "LIMITED-BOX",
      name: "Limited Edition Box",
      slug: "limited-box",
      kind: ProductKind.PACKAGE,
      category: "Packages",
      description: "Sold-out seed product for smoke",
      basePriceCents: 7200,
      tracksInventory: true,
      sortOrder: 2,
    },
    update: {
      category: "Packages",
      isActive: true,
      basePriceCents: 7200,
    },
  });

  const merch = await db.product.upsert({
    where: { seasonId_sku: { seasonId: season.id, sku: "TOTE" } },
    create: {
      seasonId: season.id,
      sku: "TOTE",
      name: "Canvas Tote",
      slug: "canvas-tote",
      kind: ProductKind.MERCH,
      category: "Merch",
      description: "Reusable tote",
      basePriceCents: 1800,
      tracksInventory: true,
      sortOrder: 3,
    },
    update: {
      category: "Merch",
      isActive: true,
    },
  });

  const archiveSeason = await db.season.upsert({
    where: { slug: "purim-2025" },
    create: {
      slug: "purim-2025",
      name: "Purim 2025",
      year: 2025,
      status: SeasonStatus.CLOSED,
      opensAt: new Date("2025-02-01T00:00:00Z"),
      closesAt: new Date("2025-03-20T00:00:00Z"),
      nextOrderNumber: 50,
    },
    update: {
      status: SeasonStatus.CLOSED,
      name: "Purim 2025",
    },
  });

  await db.product.upsert({
    where: { seasonId_sku: { seasonId: archiveSeason.id, sku: "CLASSIC-2025" } },
    create: {
      seasonId: archiveSeason.id,
      sku: "CLASSIC-2025",
      name: "Classic 2025 Box",
      slug: "classic-2025",
      kind: ProductKind.PACKAGE,
      category: "Packages",
      description: "Archived season product",
      basePriceCents: 4800,
      tracksInventory: false,
      sortOrder: 1,
    },
    update: {
      isActive: true,
      category: "Packages",
    },
  });

  await db.productOption.upsert({
    where: { productId_name: { productId: product.id, name: "Standard" } },
    create: {
      productId: product.id,
      name: "Standard",
      priceAdjustmentCents: 0,
      sortOrder: 1,
    },
    update: { priceAdjustmentCents: 0, isActive: true },
  });

  const deluxeOption = await db.productOption.upsert({
    where: { productId_name: { productId: product.id, name: "Deluxe" } },
    create: {
      productId: product.id,
      name: "Deluxe",
      priceAdjustmentCents: 1200,
      sortOrder: 2,
    },
    update: { priceAdjustmentCents: 1200, isActive: true },
  });

  const addOn = await db.addOn.upsert({
    where: { sku: "WINE-BOTTLE" },
    create: {
      sku: "WINE-BOTTLE",
      name: "Kosher Wine",
      priceCents: 1800,
      tracksInventory: true,
      isRestricted: true,
    },
    update: {
      priceCents: 1800,
      isRestricted: true,
      isActive: true,
    },
  });

  await db.productAddOnAllow.upsert({
    where: {
      productId_addOnId: { productId: product.id, addOnId: addOn.id },
    },
    create: { productId: product.id, addOnId: addOn.id },
    update: {},
  });

  assertInventoryTargetXor({ productId: product.id, addOnId: null });
  await db.inventoryItem.upsert({
    where: { productId: product.id },
    create: {
      productId: product.id,
      onHand: 25,
      reserved: 0,
      version: 1,
    },
    update: {
      onHand: 25,
      reserved: 0,
    },
  });

  assertInventoryTargetXor({ productId: soldOut.id, addOnId: null });
  await db.inventoryItem.upsert({
    where: { productId: soldOut.id },
    create: {
      productId: soldOut.id,
      onHand: 0,
      reserved: 0,
      version: 1,
    },
    update: {
      onHand: 0,
      reserved: 0,
    },
  });

  assertInventoryTargetXor({ productId: merch.id, addOnId: null });
  await db.inventoryItem.upsert({
    where: { productId: merch.id },
    create: {
      productId: merch.id,
      onHand: 40,
      reserved: 0,
      version: 1,
    },
    update: {
      onHand: 40,
      reserved: 0,
    },
  });

  assertInventoryTargetXor({ productId: null, addOnId: addOn.id });
  await db.inventoryItem.upsert({
    where: { addOnId: addOn.id },
    create: {
      addOnId: addOn.id,
      onHand: 10,
      reserved: 0,
      version: 1,
    },
    update: {
      onHand: 10,
      reserved: 0,
    },
  });

  await db.pickupLocation.upsert({
    where: { code: "MAIN-HALL" },
    create: {
      code: "MAIN-HALL",
      name: "Main Hall",
      line1: "500 Community Ave",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11218",
    },
    update: { isActive: true },
  });

  const packageType = await db.packageType.upsert({
    where: { code: "MED-BOX" },
    create: {
      code: "MED-BOX",
      name: "Medium box",
      lengthIn: 14,
      widthIn: 10,
      heightIn: 6,
      maxWeightOz: 320,
    },
    update: { isActive: true },
  });

  await db.shipmentBox.upsert({
    where: { barcode: "SEED-BOX-001" },
    create: {
      packageTypeId: packageType.id,
      label: "Seed box 001",
      barcode: "SEED-BOX-001",
    },
    update: { packageTypeId: packageType.id },
  });

  const flour = await db.ingredient.upsert({
    where: { sku: "FLOUR" },
    create: { sku: "FLOUR", name: "Flour", unit: "lb", onHand: 50 },
    update: { isActive: true },
  });

  await db.bomLine.upsert({
    where: {
      productId_ingredientId: {
        productId: product.id,
        ingredientId: flour.id,
      },
    },
    create: {
      productId: product.id,
      ingredientId: flour.id,
      quantity: 2.5,
    },
    update: { quantity: 2.5 },
  });

  const greeting = "Chag Purim Sameach!";
  const groupingKey = buildGroupingKey({
    recipientName: "Rivky Cohen",
    addressLine1: "200 Ocean Pkwy",
    city: "Brooklyn",
    state: "NY",
    postalCode: "11218",
    country: "US",
    fulfillmentMethodCode: shipMethod.code,
    greeting,
  });

  const existingDraft = await db.order.findFirst({
    where: { seasonId: season.id, draftRef: { startsWith: "D-2026-SEED" } },
  });

  let orderId = existingDraft?.id;
  if (!orderId) {
    const draftRef = formatDraftRef(2026, `SEED${randomBytes(3).toString("hex")}`);
    const order = await db.order.create({
      data: {
        seasonId: season.id,
        customerId: customer.id,
        status: OrderStatus.DRAFT,
        draftRef,
        greetingDefault: greeting,
        lines: {
          create: {
            productId: product.id,
            productOptionId: deluxeOption.id,
            quantity: 1,
            unitPriceCents: product.basePriceCents,
            optionAdjustCents: deluxeOption.priceAdjustmentCents,
            recipientName: "Rivky Cohen",
            addressLine1: "200 Ocean Pkwy",
            city: "Brooklyn",
            state: "NY",
            postalCode: "11218",
            country: "US",
            fulfillmentMethodId: shipMethod.id,
            greeting,
            groupingKey,
            addOns: {
              create: {
                addOnId: addOn.id,
                quantity: 1,
                unitPriceCents: addOn.priceCents,
              },
            },
          },
        },
      },
    });
    orderId = order.id;
  }

  await db.appSetting.upsert({
    where: { key: "shipping.deliveryZips" },
    create: {
      key: "shipping.deliveryZips",
      value: { zips: ["11218", "11219", "11230", "11204"] },
      version: 1,
    },
    update: {
      value: { zips: ["11218", "11219", "11230", "11204"] },
    },
  });

  await db.appSetting.upsert({
    where: { key: SETUP_LOCK_KEY },
    create: {
      key: SETUP_LOCK_KEY,
      value: { complete: true, seeded: true, phase: "P3" },
      version: 1,
    },
    update: {
      value: { complete: true, seeded: true, phase: "P3" },
    },
  });

  const counts = {
    seasons: await db.season.count(),
    products: await db.product.count(),
    customers: await db.customer.count(),
    orders: await db.order.count(),
  };

  console.log(
    JSON.stringify(
      {
        ok: true,
        managerId: manager.id,
        staffId: staff.id,
        seasonId: season.id,
        productId: product.id,
        customerId: customer.id,
        orderId,
        counts,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
