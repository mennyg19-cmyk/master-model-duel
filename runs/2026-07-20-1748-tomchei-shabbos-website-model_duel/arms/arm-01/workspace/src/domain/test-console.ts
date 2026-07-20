import type { PrismaClient } from "@prisma/client";

const SCALE_PREFIX = "p12-scale-";

export function assertTestConsoleEnabled() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_TEST_AUTH !== "true"
  ) {
    throw new Error("Test console is disabled outside the local test environment.");
  }
}

async function inChunks<T>(
  values: T[],
  operation: (chunk: T[]) => Promise<unknown>,
) {
  for (let offset = 0; offset < values.length; offset += 500) {
    await operation(values.slice(offset, offset + 500));
  }
}

export async function wipeScaleFixture(db: PrismaClient) {
  assertTestConsoleEnabled();
  const orders = await db.order.findMany({
    where: { draftReference: { startsWith: SCALE_PREFIX } },
    select: { id: true, customerId: true },
  });
  const orderIds = orders.map((order) => order.id);
  if (orderIds.length) {
    await db.packageLine.deleteMany({
      where: { package: { orderId: { in: orderIds } } },
    });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  await db.customer.deleteMany({
    where: { id: { in: orders.map((order) => order.customerId) } },
  });
  return { deletedOrders: orders.length };
}

export async function seedScaleFixture(db: PrismaClient) {
  assertTestConsoleEnabled();
  await wipeScaleFixture(db);
  const setting = await db.appSetting.findUnique({
    where: { key: "current-season-id" },
  });
  const seasonId = typeof setting?.value === "string" ? setting.value : null;
  if (!seasonId) throw new Error("Current season is required for scale seeding.");
  const [product, fulfillmentMethod] = await Promise.all([
    db.product.findFirstOrThrow({
      where: { seasonId, kind: "PACKAGE" },
      orderBy: { createdAt: "asc" },
    }),
    db.fulfillmentMethod.findFirstOrThrow({
      where: { seasonId, isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  const customers = Array.from({ length: 1_000 }, (_, index) => ({
    id: `${SCALE_PREFIX}customer-${index}`,
    displayName: `Scale Customer ${index + 1}`,
    email: `scale-${index}@example.test`,
    emailNormalized: `scale-${index}@example.test`,
  }));
  await inChunks(customers, (chunk) =>
    db.customer.createMany({ data: chunk }),
  );
  const orders = customers.map((customer, index) => ({
    id: `${SCALE_PREFIX}order-${index}`,
    seasonId,
    customerId: customer.id,
    status: "FINALIZED" as const,
    orderNumber: 1_900_000 + index,
    draftReference: `${SCALE_PREFIX}${index}`,
    cachedPaymentStatus: "PAID" as const,
    subtotalCents: product.priceCents * 5,
    totalCents: product.priceCents * 5,
    finalizedAt: new Date(),
  }));
  await inChunks(orders, (chunk) => db.order.createMany({ data: chunk }));
  const lines = orders.map((order, index) => ({
    id: `${SCALE_PREFIX}line-${index}`,
    orderId: order.id,
    productId: product.id,
    fulfillmentMethodId: fulfillmentMethod.id,
    recipientSource: "ON_ORDER" as const,
    recipientNameSnapshot: customers[index]!.displayName,
    productNameSnapshot: product.name,
    skuSnapshot: product.sku,
    unitPriceCentsSnapshot: product.priceCents,
    quantity: 5,
  }));
  await inChunks(lines, (chunk) => db.orderLine.createMany({ data: chunk }));
  const packages = orders.flatMap((order, orderIndex) =>
    Array.from({ length: 5 }, (_, packageIndex) => ({
      id: `${SCALE_PREFIX}package-${orderIndex}-${packageIndex}`,
      orderId: order.id,
      fulfillmentMethodId: fulfillmentMethod.id,
      recipientName: `${customers[orderIndex]!.displayName} ${packageIndex + 1}`,
      addressSnapshot: {
        line1: `${100 + packageIndex} Scale Avenue`,
        city: "Lakewood",
        region: "NJ",
        postalCode: "08701",
      },
      greetingSnapshot: "A freilichen Purim",
      groupingKey: `${SCALE_PREFIX}group-${packageIndex}`,
    })),
  );
  await inChunks(packages, (chunk) => db.package.createMany({ data: chunk }));
  const packageLines = packages.map((orderPackage) => {
    const orderIndex = Number(orderPackage.orderId.split("-").at(-1));
    return {
      packageId: orderPackage.id,
      orderLineId: `${SCALE_PREFIX}line-${orderIndex}`,
      quantity: 1,
    };
  });
  await inChunks(packageLines, (chunk) =>
    db.packageLine.createMany({ data: chunk }),
  );
  return { orders: orders.length, packages: packages.length };
}
