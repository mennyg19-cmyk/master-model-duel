import { PrismaClient } from "@prisma/client";

// Crunch-scale fixtures (G-024, R-105 smoke S4): 1,200 orders (1,000 finalized
// + 200 drafts for bulk-action races) and 5,000 packages in the open season.
// Fixture rows are written directly — this script tests the admin surfaces at
// scale, not the checkout flow (P5's smoke covers that). Idempotent: re-runs
// are no-ops once the marker customer exists.

const db = new PrismaClient();

const FINALIZED_ORDERS = 1000;
const DRAFT_ORDERS = 200;
const PACKAGES_PER_ORDER = 5; // 1000 × 5 = 5000 packages
const CUSTOMER_COUNT = 100;
const MARKER_EMAIL = "scale-cust-0@example.test";

async function main() {
  const already = await db.customer.findUnique({ where: { email: MARKER_EMAIL } });
  if (already) {
    console.log("Scale fixtures already seeded — nothing to do.");
    return;
  }

  const season = await db.season.findFirst({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } });
  if (!season) throw new Error("No open season — run db:seed first");
  const method = await db.fulfillmentMethod.findUniqueOrThrow({ where: { code: "local_delivery" } });
  const product = await db.product.findFirstOrThrow({
    where: { seasonId: season.id, slug: "classic-basket" },
  });

  const customers = await db.customer.createManyAndReturn({
    data: Array.from({ length: CUSTOMER_COUNT }, (_, i) => ({
      email: `scale-cust-${i}@example.test`,
      name: `Scale Customer ${i}`,
    })),
    select: { id: true },
  });

  // Claim a block of sequential order numbers atomically against the counter.
  const bumped = await db.season.update({
    where: { id: season.id },
    data: { orderCounter: { increment: FINALIZED_ORDERS } },
    select: { orderCounter: true },
  });
  const firstNumber = bumped.orderCounter - FINALIZED_ORDERS + 1;

  const now = Date.now();
  const address = (n: number) => ({
    recipientName: `Scale Recipient ${n}`,
    addressLine1: `${100 + (n % 899)} Scale St`,
    city: "Lakewood",
    state: "NJ",
    zip: "08701",
  });

  console.time("orders");
  const finalized = await db.order.createManyAndReturn({
    data: Array.from({ length: FINALIZED_ORDERS }, (_, i) => ({
      seasonId: season.id,
      customerId: customers[i % CUSTOMER_COUNT].id,
      status: "FINALIZED" as const,
      draftReference: `SCALE-F-${i}`,
      orderNumber: firstNumber + i,
      itemsCents: product.basePriceCents * PACKAGES_PER_ORDER,
      feesCents: 500,
      totalCents: product.basePriceCents * PACKAGES_PER_ORDER + 500,
      paymentStatus: i % 2 === 0 ? ("PAID" as const) : ("UNPAID" as const),
      finalizedAt: new Date(now - i * 60_000),
      createdAt: new Date(now - i * 60_000),
    })),
    select: { id: true, totalCents: true, paymentStatus: true },
  });
  await db.order.createMany({
    data: Array.from({ length: DRAFT_ORDERS }, (_, i) => ({
      seasonId: season.id,
      customerId: customers[i % CUSTOMER_COUNT].id,
      status: "DRAFT" as const,
      draftReference: `SCALE-D-${i}`,
      itemsCents: product.basePriceCents,
      totalCents: product.basePriceCents,
      createdAt: new Date(now - i * 30_000),
    })),
  });
  console.timeEnd("orders");

  console.time("packages+lines");
  const stages = ["NEW", "PRINTED", "PACKED"] as const;
  for (let batch = 0; batch < FINALIZED_ORDERS; batch += 100) {
    const slice = finalized.slice(batch, batch + 100);
    const packages = await db.package.createManyAndReturn({
      data: slice.flatMap((_, orderOffset) =>
        Array.from({ length: PACKAGES_PER_ORDER }, (_, r) => {
          const n = (batch + orderOffset) * PACKAGES_PER_ORDER + r;
          return {
            seasonId: season.id,
            groupingKey: `scale|${n}`,
            ...address(n),
            fulfillmentMethodId: method.id,
            stage: stages[n % stages.length],
          };
        })
      ),
      select: { id: true },
    });
    await db.orderLine.createMany({
      data: slice.flatMap((order, orderOffset) =>
        Array.from({ length: PACKAGES_PER_ORDER }, (_, r) => {
          const n = (batch + orderOffset) * PACKAGES_PER_ORDER + r;
          return {
            orderId: order.id,
            productId: product.id,
            quantity: 1,
            unitPriceCents: product.basePriceCents,
            ...address(n),
            fulfillmentMethodId: method.id,
            greeting: "A freilichen Purim!",
            packageId: packages[orderOffset * PACKAGES_PER_ORDER + r].id,
          };
        })
      ),
    });
  }
  console.timeEnd("packages+lines");

  // Paid orders get a matching payment row so money views add up.
  console.time("payments");
  await db.payment.createMany({
    data: finalized
      .filter((order) => order.paymentStatus === "PAID")
      .map((order) => ({
        orderId: order.id,
        method: "CHECK" as const,
        amountCents: order.totalCents,
        note: "Scale fixture payment",
      })),
  });
  console.timeEnd("payments");

  console.log(
    `Scale fixtures: ${FINALIZED_ORDERS} finalized + ${DRAFT_ORDERS} draft orders, ` +
      `${FINALIZED_ORDERS * PACKAGES_PER_ORDER} packages, ${CUSTOMER_COUNT} customers.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
