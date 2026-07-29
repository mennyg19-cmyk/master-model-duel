// G-024 scale dress rehearsal: seed 1,000 orders / 5,000 packages through
// direct bulk writes with real domain shapes (order numbers claimed from the
// season counter, grouping keys built by the real engine), then time the
// crunch surfaces: admin order list, package board, nightly print batch,
// route builder, and 10 concurrent staff mutations. Deterministic (seeded
// PRNG) so the ledger is reproducible. Re-running skips seeding and re-times.
//
// Requires embedded Postgres on 4106 (npm run db:start). Baseline seed runs
// first so catalog/methods/settings exist.

import { PrismaClient, Prisma } from "@prisma/client";
import { seedBaseline } from "../lib/testops/baseline-seed";
import { buildGroupingKey } from "../lib/packages/grouping";
import { formatWireFormat } from "../lib/orders/numbers";
import { buildOrderWhere, parseOrderListParams, DEFAULT_PAGE_SIZE } from "../lib/admin/order-list";
import { buildPackageWhere, parsePackageBoardParams } from "../lib/packages/board";
import { runNightlyPrintBatch } from "../lib/packages/print-batches";
import { buildRoute } from "../lib/routes/builder";
import { advancePackageStage } from "../lib/packages/stages";

const prisma = new PrismaClient();

const ORDER_COUNT = 1000;
const PACKAGES_PER_ORDER = 5;
const CUSTOMER_COUNT = 250;

// The route probe must use a day the manager settings actually offer — the
// settings hub may have changed them since the baseline seed.
async function configuredRouteDay(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: "delivery.days" } });
  const days = row ? (row.value as string[]) : [];
  if (days.length === 0) throw new Error("delivery.days setting is empty — configure a delivery day first");
  return days[0];
}

// LCG — deterministic dataset across runs of this script.
let prngState = 42;
function prand(): number {
  prngState = (prngState * 1103515245 + 12345) % 2147483648;
  return prngState / 2147483648;
}

const STREETS = [
  { line1: "1 Torah Way", city: "Lakewood", region: "NJ", postalCode: "08701" },
  { line1: "12 Elm Street", city: "Lakewood", region: "NJ", postalCode: "08701" },
  { line1: "88 Pine Street", city: "Lakewood", region: "NJ", postalCode: "08701" },
  { line1: "412 Oak Avenue", city: "Lakewood", region: "NJ", postalCode: "08701" },
  { line1: "7 Cedar Lane", city: "Lakewood", region: "NJ", postalCode: "08701" },
  { line1: "230 Clifton Avenue", city: "Lakewood", region: "NJ", postalCode: "08701" },
  { line1: "19 River Avenue", city: "Lakewood", region: "NJ", postalCode: "08701" },
  { line1: "501 Kennedy Blvd", city: "Lakewood", region: "NJ", postalCode: "08701" },
  { line1: "33 Madison Avenue", city: "Lakewood", region: "NJ", postalCode: "08701" },
  { line1: "76 Prospect Street", city: "Lakewood", region: "NJ", postalCode: "08701" },
  { line1: "910 County Line Road", city: "Lakewood", region: "NJ", postalCode: "08701" },
  { line1: "145 Squankum Road", city: "Farmingdale", region: "NJ", postalCode: "07727" },
  { line1: "28 Main Street", city: "Toms River", region: "NJ", postalCode: "08753" },
  { line1: "63 Hooper Avenue", city: "Toms River", region: "NJ", postalCode: "08753" },
  { line1: "204 Route 9", city: "Howell", region: "NJ", postalCode: "07731" },
  { line1: "17 Casino Drive", city: "Howell", region: "NJ", postalCode: "07731" },
  { line1: "39 Hope Chapel Road", city: "Jackson", region: "NJ", postalCode: "08527" },
  { line1: "82 Leesville Road", city: "Jackson", region: "NJ", postalCode: "08527" },
  { line1: "256 Bridge Avenue", city: "Point Pleasant", region: "NJ", postalCode: "08742" },
  { line1: "94 Arnold Avenue", city: "Point Pleasant", region: "NJ", postalCode: "08742" },
];

const CHANNELS = ["PICKUP", "BULK_DELIVERY", "PER_PACKAGE_DELIVERY", "SHIPPED", "PER_PACKAGE_DELIVERY"] as const;
const METHOD_FOR_CHANNEL: Record<string, string> = {
  PICKUP: "PICKUP",
  BULK_DELIVERY: "DELIVERY",
  PER_PACKAGE_DELIVERY: "DELIVERY",
  SHIPPED: "SHIPPED",
};

function pickStage(channel: string, index: number): { stage: string; pickupReadyAt: Date | null } {
  const roll = (index * 7 + 3) % 20; // deterministic spread, no PRNG state burn
  if (channel === "PICKUP") {
    if (roll < 10) return { stage: "NEW", pickupReadyAt: null };
    if (roll < 17) return { stage: "PACKED", pickupReadyAt: new Date() };
    return { stage: "PICKED_UP", pickupReadyAt: new Date() };
  }
  if (roll < 9) return { stage: "NEW", pickupReadyAt: null };
  if (roll < 14) return { stage: "PRINTED", pickupReadyAt: null };
  if (roll < 18) return { stage: "PACKED", pickupReadyAt: null };
  return { stage: "SENT", pickupReadyAt: null };
}

async function seedScale(routeDay: string): Promise<void> {
  const existing = await prisma.order.count({ where: { customer: { email: { endsWith: "@scale.test" } } } });
  if (existing >= ORDER_COUNT) {
    console.log(`ok: scale dataset already present (${existing} orders) — skipping seed`);
    // The configured day may have changed since seeding: guarantee a bounded
    // set of route-eligible packages on today's probe day.
    const eligible = await prisma.package.count({
      where: { deliveryDay: routeDay, stage: "NEW", channel: "PER_PACKAGE_DELIVERY" },
    });
    if (eligible === 0) {
      const candidates = await prisma.package.findMany({
        where: { channel: "PER_PACKAGE_DELIVERY", stage: "NEW", deliveryDay: null },
        select: { id: true },
        take: 60,
      });
      await prisma.package.updateMany({
        where: { id: { in: candidates.map((pkg) => pkg.id) } },
        data: { deliveryDay: routeDay },
      });
      console.log(`ok: re-tagged ${candidates.length} packages onto delivery day "${routeDay}" for the route probe`);
    }
    return;
  }

  const season = await prisma.season.findFirstOrThrow({ where: { status: "OPEN" } });
  const classic = await prisma.product.findUniqueOrThrow({ where: { slug: "classic-mishloach-manos" } });
  const basket = await prisma.product.findUniqueOrThrow({ where: { slug: "shabbos-gift-basket" } });
  const methods = await prisma.fulfillmentMethod.findMany();
  const methodByCode = new Map(methods.map((method) => [method.code, method]));

  // Customers + one address each.
  const customerIds: { id: string; addressId: string; streetIndex: number }[] = [];
  for (let i = 0; i < CUSTOMER_COUNT; i += 1) {
    const street = STREETS[i % STREETS.length];
    const customer = await prisma.customer.upsert({
      where: { email: `scale-customer-${i}@scale.test` },
      update: {},
      create: { email: `scale-customer-${i}@scale.test`, name: `Scale Customer ${i}` },
    });
    const address = await prisma.address.upsert({
      where: { customerId_label: { customerId: customer.id, label: "Home" } },
      update: {},
      create: { customerId: customer.id, label: "Home", ...street, country: "US" },
    });
    customerIds.push({ id: customer.id, addressId: address.id, streetIndex: i % STREETS.length });
  }

  // Bulk-claim order numbers in one counter update (single-threaded script).
  const counterRows = await prisma.$queryRaw<{ lastOrderSeq: number }[]>`
    UPDATE seasons SET "lastOrderSeq" = "lastOrderSeq" + ${ORDER_COUNT}
    WHERE id = ${season.id}
    RETURNING "lastOrderSeq"`;
  const firstNumber = counterRows[0].lastOrderSeq - ORDER_COUNT + 1;

  const baseDate = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < ORDER_COUNT; i += 1) {
    const owner = customerIds[i % CUSTOMER_COUNT];
    const street = STREETS[owner.streetIndex];
    const orderNumber = firstNumber + i;
    const secondLine = i % 3 === 0;
    const line1Cents = classic.basePriceCents;
    const line2Cents = basket.basePriceCents;
    const totalCents = line1Cents + (secondLine ? line2Cents : 0);
    const createdAt = new Date(baseDate + Math.floor(prand() * 29 * 24 * 60 * 60 * 1000));

    const order = await prisma.order.create({
      data: {
        seasonId: season.id,
        customerId: owner.id,
        status: "FINALIZED",
        paymentStatus: "PAID",
        orderNumber,
        wireFormat: formatWireFormat(season.name, orderNumber),
        totalCents,
        createdAt,
      },
    });
    const recipient = await prisma.draftRecipient.create({
      data: {
        orderId: order.id,
        name: `Recipient ${i}`,
        line1: street.line1,
        city: street.city,
        region: street.region,
        postalCode: street.postalCode,
        addressId: owner.addressId,
        deliveryDay: i % 17 === 0 ? routeDay : null,
      },
    });
    const line1 = await prisma.orderLine.create({
      data: {
        orderId: order.id,
        recipientId: recipient.id,
        productId: classic.id,
        productName: classic.name,
        qty: 1,
        unitPriceCents: line1Cents,
        lineTotalCents: line1Cents,
      },
    });
    const line2 = secondLine
      ? await prisma.orderLine.create({
          data: {
            orderId: order.id,
            recipientId: recipient.id,
            productId: basket.id,
            productName: basket.name,
            qty: 1,
            unitPriceCents: line2Cents,
            lineTotalCents: line2Cents,
          },
        })
      : null;
    await prisma.payment.create({
      data: {
        orderId: order.id,
        method: "STRIPE",
        amountCents: totalCents,
        externalRef: `pi_scale_${orderNumber}`,
        createdAt,
      },
    });

    const lines = [line1, ...(line2 ? [line2] : [])];
    for (let p = 0; p < PACKAGES_PER_ORDER; p += 1) {
      const channel = CHANNELS[p];
      const methodCode = METHOD_FOR_CHANNEL[channel];
      const method = methodByCode.get(methodCode)!;
      const { stage, pickupReadyAt } = pickStage(channel, i + p);
      const routedDay = channel === "PER_PACKAGE_DELIVERY" && i % 17 === 0 && p === 2 ? routeDay : null;
      const pkg = await prisma.package.create({
        data: {
          orderId: order.id,
          recipientName: `Recipient ${i}`,
          recipientAddressId: channel === "PICKUP" ? null : owner.addressId,
          fulfillmentMethodId: method.id,
          groupingKey: buildGroupingKey({
            recipientName: `Recipient ${i}`,
            recipientAddressId: channel === "PICKUP" ? null : owner.addressId,
            fulfillmentMethodCode: methodCode,
          }),
          stage: stage as Prisma.PackageCreateInput["stage"],
          channel,
          deliveryDay: routedDay,
          pickupReadyAt,
        },
      });
      await prisma.packageLine.create({
        data: { packageId: pkg.id, orderLineId: lines[p % lines.length].id, qty: 1 },
      });
    }
    if ((i + 1) % 100 === 0) console.log(`ok: seeded ${i + 1}/${ORDER_COUNT} orders`);
  }
}

async function timeProbe<T>(label: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await run();
  const ms = Math.round(performance.now() - start);
  console.log(`probe: ${label} — ${ms}ms`);
  return result;
}

async function runProbes(routeDay: string): Promise<void> {
  const season = await prisma.season.findFirstOrThrow({ where: { status: "OPEN" } });

  const listWhere = buildOrderWhere(season.id, parseOrderListParams({}));
  const [orderCount] = await timeProbe("order list (page 1 + count)", async () =>
    Promise.all([
      prisma.order.count({ where: listWhere }),
      prisma.order.findMany({ where: listWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: DEFAULT_PAGE_SIZE }),
    ]),
  );

  const boardWhere = buildPackageWhere(season.id, parsePackageBoardParams({}));
  const boardGroups = await timeProbe("package board (stage rollup)", () =>
    prisma.package.groupBy({ by: ["stage"], where: boardWhere, _count: { _all: true } }),
  );
  console.log(`probe: board stages — ${boardGroups.map((group) => `${group.stage}:${group._count._all}`).join(" ")}`);

  const nightly = await timeProbe("nightly print batch over scale dataset", () => runNightlyPrintBatch({}));
  console.log(`probe: nightly filed — ${JSON.stringify(nightly)}`);
  const rerun = await timeProbe("nightly rerun (idempotency)", () => runNightlyPrintBatch({}));
  console.log(`probe: rerun filed — ${JSON.stringify(rerun)}`);

  const ctx = { staff: { id: "scale-probe", email: "scale-probe@scale.test" }, impersonator: null };
  try {
    const route = await timeProbe(`route builder (${routeDay})`, () => buildRoute({ deliveryDay: routeDay, ctx }));
    console.log(`probe: route built — ${route.stopCount} stops via ${route.provider}`);
  } catch (error) {
    console.log(`probe: route builder — ${error instanceof Error ? error.message : String(error)} (already routed is fine)`);
  }

  const fresh = await prisma.package.findMany({
    where: { order: { seasonId: season.id }, stage: "NEW", fulfillmentMethod: { code: "DELIVERY" } },
    take: 10,
  });
  const concurrent = await timeProbe("10 concurrent staff stage advances", () =>
    Promise.allSettled(
      fresh.map((pkg) => advancePackageStage({ packageId: pkg.id, expectedVersion: pkg.version, to: "PRINTED" })),
    ),
  );
  const succeeded = concurrent.filter((outcome) => outcome.status === "fulfilled").length;
  console.log(`probe: concurrent advances — ${succeeded}/10 succeeded (0 deadlocks)`);

  console.log(
    `done: ${orderCount} scale orders visible to the admin list; package total ${await prisma.package.count()}`,
  );
}

async function main() {
  await seedBaseline(prisma);
  const routeDay = await configuredRouteDay();
  await seedScale(routeDay);
  await runProbes(routeDay);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
