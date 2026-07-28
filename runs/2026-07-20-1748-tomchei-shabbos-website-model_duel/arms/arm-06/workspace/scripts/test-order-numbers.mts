// DB integration: concurrent finalizations claim unique sequential per-season
// order numbers (R-151) — no double-claim; discard + re-finalize guards hold.
// Also covers the createDraftOrder trust boundary (catalog snapshot, id
// validation) and the discard/finalize conditional-UPDATE guards.
// Requires embedded Postgres on 4106 (db:start).
import { PrismaClient } from "@prisma/client";
import { createDraftOrder } from "../lib/orders/create-draft";
import {
  discardOrder,
  finalizeOrder,
  IllegalTransitionError,
} from "../lib/orders/state-machine";
import { DRAFT_REF_PREFIX, WIRE_FORMAT_PREFIX } from "../lib/orders/numbers";
import { DomainRuleError, NotFoundError } from "../lib/errors";
import { closeAllOpenSeasons, expectThrow, reopenSeasons } from "./test-db-helpers.mts";

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

const previouslyOpen = await closeAllOpenSeasons(prisma);

const season = await prisma.season.create({
  data: { name: `TEST-${Date.now()}`, status: "OPEN" },
});
const customer = await prisma.customer.create({
  data: { email: `race-${Date.now()}@example.org`, name: "Race Customer" },
});
const product = await prisma.product.create({
  data: { slug: `race-product-${Date.now()}`, name: "Test Package", basePriceCents: 1000 },
});
const otherProduct = await prisma.product.create({
  data: { slug: `other-product-${Date.now()}`, name: "Other Package", basePriceCents: 2000 },
});
const sizeOption = await prisma.productOption.create({ data: { productId: product.id, name: "Size" } });
const sizeStandard = await prisma.productOptionValue.create({
  data: { optionId: sizeOption.id, label: "Standard", priceDeltaCents: 0 },
});
const addOn = await prisma.addOn.create({
  data: { slug: `race-addon-${Date.now()}`, name: "Race Add-on", priceCents: 250 },
});
await prisma.productAddOn.create({ data: { productId: product.id, addOnId: addOn.id } });

const line = { productId: product.id, qty: 1 };

// createDraftOrder trust boundary: ids are validated, prices are snapshotted
check(
  "fabricated productId rejected (NotFoundError)",
  await expectThrow(
    () => createDraftOrder({ seasonId: season.id, customerId: customer.id, lines: [{ productId: "no-such-product", qty: 1 }] }),
    NotFoundError,
  ),
);
check(
  "negative qty rejected (DomainRuleError)",
  await expectThrow(
    () => createDraftOrder({ seasonId: season.id, customerId: customer.id, lines: [{ productId: product.id, qty: -1 }] }),
    DomainRuleError,
  ),
);
check(
  "option value from another product rejected",
  await expectThrow(
    () =>
      createDraftOrder({
        seasonId: season.id,
        customerId: customer.id,
        lines: [{ productId: otherProduct.id, optionValueId: sizeStandard.id, qty: 1 }],
      }),
    DomainRuleError,
  ),
);
check(
  "add-on line without parentLineId rejected",
  await expectThrow(
    () => createDraftOrder({ seasonId: season.id, customerId: customer.id, lines: [{ addOnId: addOn.id, qty: 1 }] }),
    DomainRuleError,
  ),
);

// Snapshot: caller cannot inject a price — the engine reads the catalog
const parentLineId = crypto.randomUUID();
const withAddOn = await createDraftOrder({
  seasonId: season.id,
  customerId: customer.id,
  lines: [
    { id: parentLineId, productId: product.id, optionValueId: sizeStandard.id, qty: 2 },
    { addOnId: addOn.id, parentLineId, qty: 1 },
  ],
});
check(
  "engine snapshots catalog prices into the total (2×1000 + 1×250)",
  withAddOn.totalCents === 2250,
);
const addOnLine = withAddOn.lines.find((l) => l.addOnId === addOn.id);
check(
  "add-on line hangs off the parent product line",
  addOnLine?.parentLineId === parentLineId,
);
check(
  "add-on line snapshots the add-on name/price, not caller input",
  addOnLine?.productName === addOn.name && addOnLine?.unitPriceCents === 250,
);
const productLine = withAddOn.lines.find((l) => l.productId === product.id);
check(
  "product line snapshots option label from the catalog",
  productLine?.optionLabel === "Size: Standard",
);
await prisma.order.delete({ where: { id: withAddOn.id } });

// Concurrent finalization of two drafts
const draftA = await createDraftOrder({ seasonId: season.id, customerId: customer.id, lines: [line] });
const draftB = await createDraftOrder({ seasonId: season.id, customerId: customer.id, lines: [line] });
check("draft refs are distinct", draftA.draftRef !== draftB.draftRef);
check(
  "draft refs use the D-<season>-<seq> format",
  (draftA.draftRef ?? "").startsWith(`${DRAFT_REF_PREFIX}${season.name}-`) &&
    (draftB.draftRef ?? "").startsWith(`${DRAFT_REF_PREFIX}${season.name}-`),
);

const [finalA, finalB] = await Promise.all([finalizeOrder(draftA.id), finalizeOrder(draftB.id)]);
const numbers = [finalA.orderNumber ?? 0, finalB.orderNumber ?? 0].sort((a, b) => a - b);
check("both finalized", finalA.status === "FINALIZED" && finalB.status === "FINALIZED");
check("order numbers are unique", numbers[0] !== numbers[1]);
check("order numbers are sequential", numbers[1] - numbers[0] === 1);
check(
  "wire format stamped",
  (finalA.wireFormat ?? "").startsWith(`${WIRE_FORMAT_PREFIX}${season.name}-`) &&
    (finalB.wireFormat ?? "").startsWith(`${WIRE_FORMAT_PREFIX}${season.name}-`),
);
check("draft ref retained after finalize", finalA.draftRef !== null && finalB.draftRef !== null);

// Re-finalize is rejected
check(
  "re-finalize of a finalized order throws IllegalTransitionError",
  await expectThrow(() => finalizeOrder(draftA.id), IllegalTransitionError),
);

// Discard of a finalized order is rejected (same guard class as finalize)
check(
  "discard of a finalized order throws IllegalTransitionError",
  await expectThrow(() => discardOrder(draftA.id), IllegalTransitionError),
);

// Discard path
const draftC = await createDraftOrder({ seasonId: season.id, customerId: customer.id, lines: [line] });
const discarded = await discardOrder(draftC.id);
check("discard flips DRAFT → DISCARDED", discarded.status === "DISCARDED");
check(
  "finalize of a discarded order throws",
  await expectThrow(() => finalizeOrder(draftC.id), IllegalTransitionError),
);

// Finalize respects the open-season gate (UR-008) even for existing drafts
const draftD = await createDraftOrder({ seasonId: season.id, customerId: customer.id, lines: [line] });
await prisma.season.update({ where: { id: season.id }, data: { status: "CLOSED" } });
check(
  "finalize after season close throws DomainRuleError",
  await expectThrow(() => finalizeOrder(draftD.id), DomainRuleError),
);
check(
  "createDraftOrder after season close throws DomainRuleError",
  await expectThrow(
    () => createDraftOrder({ seasonId: season.id, customerId: customer.id, lines: [line] }),
    DomainRuleError,
  ),
);
await prisma.season.update({ where: { id: season.id }, data: { status: "OPEN" } });

// Cleanup
await prisma.order.deleteMany({ where: { seasonId: season.id } });
await prisma.productAddOn.deleteMany({ where: { productId: product.id } });
await prisma.productOptionValue.deleteMany({ where: { option: { productId: product.id } } });
await prisma.productOption.deleteMany({ where: { productId: product.id } });
await prisma.season.delete({ where: { id: season.id } });
await prisma.customer.delete({ where: { id: customer.id } });
await prisma.product.deleteMany({ where: { id: { in: [product.id, otherProduct.id] } } });
await prisma.addOn.delete({ where: { id: addOn.id } });
await reopenSeasons(prisma, previouslyOpen);
await prisma.$disconnect();

if (failures > 0) {
  console.error(`${failures} order-number check(s) failed`);
  process.exit(1);
}
console.log("All order-number checks passed");
