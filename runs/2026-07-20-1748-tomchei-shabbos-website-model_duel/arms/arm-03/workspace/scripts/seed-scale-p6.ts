/**
 * Scale fixtures for P6 smoke S4: ~1k orders + ~5k packages.
 * Marker: checkoutSnapshot.scaleFixture = "p6"
 */
import {
  CachedPaymentStatus,
  OrderStatus,
  PackageStage,
  PaymentMethod,
  PaymentState,
  Prisma,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { formatDraftRef } from "../src/lib/orders/draft-wire";

const ORDER_TARGET = 1000;

async function main() {
  const season = await db.season.findFirst({ orderBy: { year: "desc" } });
  if (!season) throw new Error("No season");
  const customer = await db.customer.findFirst({ where: { email: "customer@tomchei.local" } });
  if (!customer) throw new Error("Seed customer missing — run db:seed");
  const method = await db.fulfillmentMethod.findFirst({ where: { isActive: true } });
  if (!method) throw new Error("No fulfillment method");
  const product = await db.product.findFirst({ where: { sku: "FAMILY-BOX", seasonId: season.id } });
  if (!product) throw new Error("FAMILY-BOX missing");

  const existing = await db.order.count({
    where: {
      checkoutSnapshot: { path: ["scaleFixture"], equals: "p6" },
    },
  });
  const needOrders = Math.max(0, ORDER_TARGET - existing);
  console.log(`Scale fixture: have ${existing} scale orders, creating ${needOrders}…`);

  let nextNum = season.nextOrderNumber + 10_000 + existing;
  const batchSize = 40;
  for (let i = 0; i < needOrders; i += batchSize) {
    const chunk = Math.min(batchSize, needOrders - i);
    await db.$transaction(async (tx) => {
      for (let j = 0; j < chunk; j++) {
        const n = existing + i + j + 1;
        const orderNumber = nextNum++;
        const draftRef = formatDraftRef(season.year, `p6s${n}${randomBytes(3).toString("hex")}`);
        const order = await tx.order.create({
          data: {
            seasonId: season.id,
            customerId: customer.id,
            status: OrderStatus.PAID,
            orderNumber,
            draftRef,
            paymentStatusCached: CachedPaymentStatus.PAID,
            expectedTotalCents: product.basePriceCents,
            placedAt: new Date(),
            checkoutSnapshot: { scaleFixture: "p6", n } as Prisma.InputJsonValue,
            lines: {
              create: {
                productId: product.id,
                quantity: 1,
                unitPriceCents: product.basePriceCents,
                recipientName: `Scale Recip ${n}`,
                addressLine1: `${100 + (n % 900)} Scale St`,
                city: "Brooklyn",
                state: "NY",
                postalCode: "11218",
                country: "US",
                fulfillmentMethodId: method.id,
                groupingKey: `scale|${n}`,
              },
            },
            payments: {
              create: {
                method: PaymentMethod.CASH,
                state: PaymentState.POSTED,
                amountCents: product.basePriceCents,
                reference: `scale-p6-${n}`,
              },
            },
          },
        });

        await tx.package.createMany({
          data: Array.from({ length: 5 }, (_, p) => ({
            orderId: order.id,
            groupingKey: `scale|${n}|${p}`,
            recipientName: `Scale Recip ${n}-${p}`,
            addressLine1: `${100 + (n % 900)} Scale St`,
            city: "Brooklyn",
            state: "NY",
            postalCode: "11218",
            country: "US",
            fulfillmentMethodId: method.id,
            stage: PackageStage.NEW,
          })),
        });
      }
    });
    process.stdout.write(`\r  orders +${Math.min(i + chunk, needOrders)}/${needOrders}`);
  }
  console.log("");

  const scaleOrders = await db.order.count({
    where: { checkoutSnapshot: { path: ["scaleFixture"], equals: "p6" } },
  });
  const packageCount = await db.package.count();
  console.log(JSON.stringify({ ok: true, scaleOrders, packageCount }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
