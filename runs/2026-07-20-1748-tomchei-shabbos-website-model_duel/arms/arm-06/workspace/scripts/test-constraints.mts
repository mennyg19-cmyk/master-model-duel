// DB integration: regression probe for the CHECK constraints + partial unique
// index that live only in migration SQL (Prisma's datamodel can't express
// them). Runs in ci so a reset/`db push` that silently drops them fails here.
// Requires embedded Postgres on 4106 (db:start).
import { PrismaClient } from "@prisma/client";
import { closeAllOpenSeasons, reopenSeasons } from "./test-db-helpers.mts";

const prisma = new PrismaClient();
let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

async function expectReject(label: string, run: () => Promise<unknown>) {
  try {
    await run();
    check(label, false);
  } catch {
    check(label, true);
  }
}

// InventoryItem XOR (inventory_items_xor_target)
await expectReject("inventory row with neither productId nor addOnId rejected", () =>
  prisma.$executeRaw`INSERT INTO inventory_items (id, "onHand", reserved, version, "createdAt", "updatedAt") VALUES ('probe-xor-empty', 0, 0, 1, now(), now())`,
);
await expectReject("inventory row with both productId and addOnId rejected", () =>
  prisma.$executeRaw`INSERT INTO inventory_items (id, "productId", "addOnId", "onHand", reserved, version, "createdAt", "updatedAt") VALUES ('probe-xor-both', 'a', 'b', 0, 0, 1, now(), now())`,
);

// Fixtures for the order_line / shipping_quote probes
const season = await prisma.season.create({ data: { name: `TEST-CHK-${Date.now()}`, status: "CLOSED" } });
const customer = await prisma.customer.create({
  data: { email: `chk-${Date.now()}@example.org`, name: "Chk Customer" },
});
const product = await prisma.product.create({
  data: { slug: `chk-product-${Date.now()}`, name: "Chk Product", basePriceCents: 100 },
});
const addOn = await prisma.addOn.create({
  data: { slug: `chk-addon-${Date.now()}`, name: "Chk Add-on", priceCents: 50 },
});
const order = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id },
});

// OrderLine line-kind (order_lines_line_kind)
await expectReject("line with neither productId nor addOnId rejected", () =>
  prisma.orderLine.create({ data: { orderId: order.id, productName: "X", unitPriceCents: 1, lineTotalCents: 1 } }),
);
await expectReject("line with both productId and addOnId rejected", () =>
  prisma.orderLine.create({
    data: {
      orderId: order.id,
      productId: product.id,
      addOnId: addOn.id,
      productName: "X",
      unitPriceCents: 1,
      lineTotalCents: 1,
    },
  }),
);
await expectReject("add-on line without parentLineId rejected", () =>
  prisma.orderLine.create({
    data: { orderId: order.id, addOnId: addOn.id, productName: "X", unitPriceCents: 1, lineTotalCents: 1 },
  }),
);
const parentLine = await prisma.orderLine.create({
  data: { orderId: order.id, productId: product.id, productName: "P", unitPriceCents: 1, lineTotalCents: 1 },
});
await expectReject("product line with parentLineId rejected", () =>
  prisma.orderLine.create({
    data: {
      orderId: order.id,
      productId: product.id,
      parentLineId: parentLine.id,
      productName: "X",
      unitPriceCents: 1,
      lineTotalCents: 1,
    },
  }),
);
const childLine = await prisma.orderLine.create({
  data: {
    orderId: order.id,
    addOnId: addOn.id,
    parentLineId: parentLine.id,
    productName: "A",
    unitPriceCents: 1,
    lineTotalCents: 1,
  },
});
check("valid add-on line with parentLineId accepted", !!childLine.id);
await prisma.orderLine.delete({ where: { id: parentLine.id } });
check(
  "deleting a parent line cascades its add-on lines",
  (await prisma.orderLine.findUnique({ where: { id: childLine.id } })) === null,
);

// ShippingQuote target XOR (shipping_quotes_target_xor)
await expectReject("quote with neither orderId nor packageId rejected", () =>
  prisma.shippingQuote.create({ data: { options: [], expiresAt: new Date() } }),
);
const quote = await prisma.shippingQuote.create({
  data: { orderId: order.id, options: [], expiresAt: new Date() },
});
check("quote with exactly one target accepted", !!quote.id);

// Single OPEN season (seasons_single_open partial index)
const previouslyOpen = await closeAllOpenSeasons(prisma);
const openA = await prisma.season.create({ data: { name: `TEST-OPEN-A-${Date.now()}`, status: "OPEN" } });
await expectReject("a second OPEN season is rejected", () =>
  prisma.season.create({ data: { name: `TEST-OPEN-B-${Date.now()}`, status: "OPEN" } }),
);
await prisma.season.delete({ where: { id: openA.id } });

// Cleanup
await prisma.shippingQuote.deleteMany({ where: { orderId: order.id } });
await prisma.order.delete({ where: { id: order.id } });
await prisma.season.delete({ where: { id: season.id } });
await prisma.customer.delete({ where: { id: customer.id } });
await prisma.product.delete({ where: { id: product.id } });
await prisma.addOn.delete({ where: { id: addOn.id } });
await reopenSeasons(prisma, previouslyOpen);
await prisma.$disconnect();

if (failures > 0) {
  console.error(`${failures} constraint check(s) failed`);
  process.exit(1);
}
console.log("All constraint checks passed");
