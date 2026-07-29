import { Prisma, PrismaClient } from "@prisma/client";
import { BRAND } from "@/lib/brand";
import { findOrCreateCustomer } from "@/lib/customers/dedupe";
import { createDraftOrder } from "@/lib/orders/create-draft";

// Baseline seed (R-142), extracted from prisma/seed.ts so the P12 test
// console (R-101 seed/reset) runs the exact same dataset the CLI seed does.
// Non-identity data only — staff accounts are never seeded. Idempotent:
// every row upserts on a stable unique key.
type Db = PrismaClient | Prisma.TransactionClient;

export interface SeedCounts {
  seasons: number;
  products: number;
  addOns: number;
  customers: number;
  orders: number;
  fulfillmentMethods: number;
}

export async function seedBaseline(prisma: Db): Promise<SeedCounts> {
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
      category: "Packages",
      seasonId: season.id,
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

  // P3 storefront fixtures: a second current-season product in another
  // category (untracked inventory = never sold out), a sold-out tracked
  // product (onHand 0), and a CLOSED past season with its own browsable
  // catalog (archive, G-022).
  const shabbosBasket = await prisma.product.upsert({
    where: { slug: "shabbos-gift-basket" },
    update: {},
    create: {
      slug: "shabbos-gift-basket",
      name: "Shabbos Gift Basket",
      kind: "GOOD",
      basePriceCents: 5400,
      category: "Baskets",
      seasonId: season.id,
      description: "Challah cover, grape juice, and sweets in a reusable basket.",
    },
  });
  const basketOption = await prisma.productOption.upsert({
    where: { productId_name: { productId: shabbosBasket.id, name: "Ribbon" } },
    update: {},
    create: { productId: shabbosBasket.id, name: "Ribbon" },
  });
  await prisma.productOptionValue.upsert({
    where: { optionId_label: { optionId: basketOption.id, label: "Classic" } },
    update: {},
    create: { optionId: basketOption.id, label: "Classic", priceDeltaCents: 0 },
  });
  await prisma.productOptionValue.upsert({
    where: { optionId_label: { optionId: basketOption.id, label: "Festive" } },
    update: {},
    create: { optionId: basketOption.id, label: "Festive", priceDeltaCents: 300 },
  });

  const chocolateHamper = await prisma.product.upsert({
    where: { slug: "chocolate-hamper" },
    update: {},
    create: {
      slug: "chocolate-hamper",
      name: "Chocolate Hamper",
      kind: "GOOD",
      basePriceCents: 7200,
      category: "Baskets",
      seasonId: season.id,
      description: "Assorted chocolates and hamantaschen.",
      trackInventory: true,
    },
  });
  await prisma.inventoryItem.upsert({
    where: { productId: chocolateHamper.id },
    update: {},
    create: { productId: chocolateHamper.id, onHand: 0, reserved: 0 },
  });

  const pastSeason = await prisma.season.upsert({
    where: { name: "2025" },
    update: {},
    create: { name: "2025", status: "CLOSED" },
  });
  await prisma.product.upsert({
    where: { slug: "archive-classic-2025" },
    update: {},
    create: {
      slug: "archive-classic-2025",
      name: "Classic Mishloach Manos (2025)",
      kind: "GOOD",
      basePriceCents: 3200,
      category: "Packages",
      seasonId: pastSeason.id,
      active: false,
      description: "Last year's classic package.",
    },
  });
  await prisma.product.upsert({
    where: { slug: "archive-deluxe-2025" },
    update: {},
    create: {
      slug: "archive-deluxe-2025",
      name: "Deluxe Basket (2025)",
      kind: "GOOD",
      basePriceCents: 6500,
      category: "Baskets",
      seasonId: pastSeason.id,
      active: false,
      description: "Last year's deluxe basket.",
    },
  });

  // Delivery ZIP allowlist for the per-package delivery gate (S5); checkout
  // reads this live in P5, the settings hub edits it in P3.
  await prisma.setting.upsert({
    where: { key: "shipping.deliveryZips" },
    update: {},
    create: { key: "shipping.deliveryZips", value: ["08701"] },
  });

  // P5 placeholder rate rules (UR-009/G-015): bulk fee per destination,
  // per-package fee per recipient, manager-set Purim-week day choices.
  await prisma.setting.upsert({
    where: { key: "delivery.fees" },
    update: {},
    create: {
      key: "delivery.fees",
      value: { bulkPerDestinationCents: 1000, perPackagePerRecipientCents: 500 },
    },
  });
  await prisma.setting.upsert({
    where: { key: "delivery.days" },
    update: {},
    create: {
      key: "delivery.days",
      value: ["Purim week — Sunday", "Purim week — Monday", "Purim day"],
    },
  });

  // P9 pickup + payment-reminder policies (UR-010/G-017/R-080). Editable in
  // the DB; the crons refuse to guess when unset.
  await prisma.setting.upsert({
    where: { key: "pickup.policy" },
    update: {},
    create: { key: "pickup.policy", value: { unclaimedAfterDays: 3, expireAfterDays: 7 } },
  });
  await prisma.setting.upsert({
    where: { key: "payments.reminders" },
    update: {},
    create: { key: "payments.reminders", value: { initialAfterDays: 3, intervalDays: 7 } },
  });

  // P11 email platform (R-085/R-172): sender branding, retention/retry
  // policy, the default mailing list, and the three order-lifecycle triggered
  // templates. The sweeper/purge crons refuse to guess when policy is unset.
  await prisma.setting.upsert({
    where: { key: "email.branding" },
    update: {},
    create: {
      key: "email.branding",
      value: {
        fromName: BRAND.orgName,
        fromEmail: BRAND.supportEmail,
        replyToEmail: BRAND.supportEmail,
        footerText: `${BRAND.orgName} · ${BRAND.supportEmail}\nManage your email preferences anytime with the link in any of our emails.`,
      },
    },
  });
  await prisma.setting.upsert({
    where: { key: "email.policy" },
    update: {},
    create: { key: "email.policy", value: { retentionDays: 90, maxAttempts: 5 } },
  });
  await prisma.emailList.upsert({
    where: { name: "All subscribers" },
    update: {},
    create: { name: "All subscribers", description: "Every active newsletter subscriber." },
  });
  const triggeredTemplates = [
    {
      key: "order_confirmation",
      name: "Order confirmation",
      subject: "{{brand}} order {{orderRef}} — thank you",
      bodyText:
        "Hello {{customerName}},\n\nThank you for your {{brand}} order {{orderRef}} (total {{amount}}). We will take it from here — you will hear from us as your packages move.\n\n{{footer}}",
    },
    {
      key: "payment_link",
      name: "Payment link",
      subject: "{{brand}}: balance due on order {{orderRef}}",
      bodyText:
        "Hello {{customerName}},\n\nYour {{brand}} order {{orderRef}} has an outstanding balance of {{amount}}. You can view and pay your order here:\n{{payUrl}}\n\nThank you for supporting {{brand}}.\n\n{{footer}}",
    },
    {
      key: "refund_issued",
      name: "Refund issued",
      subject: "{{brand}}: refund issued for order {{orderRef}}",
      bodyText:
        "Hello {{customerName}},\n\nA refund of {{amount}} was issued for your {{brand}} order {{orderRef}}. The card statement can take a few days to show it.\n\n{{footer}}",
    },
  ];
  for (const template of triggeredTemplates) {
    await prisma.emailTemplate.upsert({
      where: { key: template.key },
      update: {},
      create: template,
    });
  }

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
  // P8: carrier shipping via Shippo (UR-003). Same stage shape as DELIVERY;
  // terminal SENT means the carrier has it (labels become unvoidable).
  await prisma.fulfillmentMethod.upsert({
    where: { code: "SHIPPED" },
    update: {},
    create: {
      code: "SHIPPED",
      label: "Carrier shipping",
      stages: ["NEW", "PRINTED", "PACKED", "SENT"],
      terminalStage: "SENT",
    },
  });

  // P8 shipping origin (the org's shipping address; labels quote from here)
  // and the boxes shipments go out in (R-081 bin packing / R-157).
  await prisma.setting.upsert({
    where: { key: "shipping.origin" },
    update: {},
    create: {
      key: "shipping.origin",
      value: {
        name: "Tomchei Shabbos of Lakewood",
        line1: "100 Orchard Street",
        city: "Lakewood",
        region: "NJ",
        postalCode: "08701",
        country: "US",
      },
    },
  });
  const packageTypes = [
    { name: "Small package", lengthMm: 250, widthMm: 200, heightMm: 150, weightGrams: 1800 },
    { name: "Large package", lengthMm: 400, widthMm: 300, heightMm: 250, weightGrams: 4200 },
  ];
  for (const type of packageTypes) {
    await prisma.packageType.upsert({
      where: { name: type.name },
      update: {},
      create: type,
    });
  }
  const boxes = [
    { name: "Small carton", lengthMm: 300, widthMm: 250, heightMm: 200, tareWeightGrams: 250 },
    { name: "Medium carton", lengthMm: 450, widthMm: 350, heightMm: 300, tareWeightGrams: 500 },
    { name: "Large carton", lengthMm: 600, widthMm: 450, heightMm: 400, tareWeightGrams: 900 },
  ];
  for (const box of boxes) {
    await prisma.shipmentBox.upsert({
      where: { name: box.name },
      update: {},
      create: box,
    });
  }

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

  return {
    seasons: await prisma.season.count(),
    products: await prisma.product.count(),
    addOns: await prisma.addOn.count(),
    customers: await prisma.customer.count(),
    orders: await prisma.order.count(),
    fulfillmentMethods: await prisma.fulfillmentMethod.count(),
  };
}
