// DB integration: package stage advance engine (R-153/R-154) — data-driven
// stage lists, optimistic versioning, package-level audit events; plus the
// open-season query (UR-008). Requires embedded Postgres on 4106 (db:start).
import { PrismaClient } from "@prisma/client";
import { createDraftOrder } from "../lib/orders/create-draft";
import {
  advancePackageStage,
  IllegalStageTransitionError,
  PackageConcurrencyError,
  parseMethodStages,
} from "../lib/packages/stages";
import { getOpenSeason } from "../lib/seasons/queries";
import { DomainRuleError } from "../lib/errors";
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

// parseMethodStages (pure): validate-or-throw on the Json column
check("valid stage list passes", parseMethodStages(["NEW", "PACKED"], "PICKUP").length === 2);
check("empty stage list throws", await expectThrow(async () => parseMethodStages([], "X"), DomainRuleError));
check("unknown stage throws", await expectThrow(async () => parseMethodStages(["NEW", "BOGUS"], "X"), DomainRuleError));
check("non-array throws", await expectThrow(async () => parseMethodStages("NEW", "X"), DomainRuleError));

const previouslyOpen = await closeAllOpenSeasons(prisma);

const season = await prisma.season.create({ data: { name: `TEST-PKG-${Date.now()}`, status: "OPEN" } });
const customer = await prisma.customer.create({
  data: { email: `pkg-${Date.now()}@example.org`, name: "Pkg Customer" },
});
const product = await prisma.product.create({
  data: { slug: `pkg-product-${Date.now()}`, name: "Pkg Product", basePriceCents: 1000 },
});
const order = await createDraftOrder({
  seasonId: season.id,
  customerId: customer.id,
  lines: [{ productId: product.id, qty: 1 }],
});
const method = await prisma.fulfillmentMethod.create({
  data: {
    code: `TEST-PICKUP-${Date.now()}`,
    label: "Test Pickup",
    stages: ["NEW", "PACKED", "PICKED_UP"],
    terminalStage: "PICKED_UP",
  },
});
const pkg = await prisma.package.create({
  data: {
    orderId: order.id,
    recipientName: "Test Recipient",
    fulfillmentMethodId: method.id,
    groupingKey: "test-key",
  },
});

// Advance with the right version
const advanced = await advancePackageStage({ packageId: pkg.id, expectedVersion: 1, to: "PACKED" });
check("stage advances NEW → PACKED", advanced.stage === "PACKED");
check("version bumped", advanced.version === 2);

// Package-level audit event written
const event = await prisma.packageEvent.findFirst({ where: { packageId: pkg.id } });
check(
  "stage_advance event recorded with from/to",
  event?.action === "stage_advance" && event?.fromStage === "NEW" && event?.toStage === "PACKED",
);

// Stale version rejected
check(
  "stale expectedVersion throws PackageConcurrencyError",
  await expectThrow(
    () => advancePackageStage({ packageId: pkg.id, expectedVersion: 1, to: "PICKED_UP" }),
    PackageConcurrencyError,
  ),
);

// Illegal transition rejected (backward, and stage outside the method's list)
check(
  "backward advance throws IllegalStageTransitionError",
  await expectThrow(
    () => advancePackageStage({ packageId: pkg.id, expectedVersion: 2, to: "NEW" }),
    IllegalStageTransitionError,
  ),
);
check(
  "stage outside the method list throws IllegalStageTransitionError",
  await expectThrow(
    () => advancePackageStage({ packageId: pkg.id, expectedVersion: 2, to: "PRINTED" }),
    IllegalStageTransitionError,
  ),
);

// getOpenSeason: the test season is the only OPEN one right now
const open = await getOpenSeason();
check("getOpenSeason returns the open season", open?.id === season.id);
await prisma.season.update({ where: { id: season.id }, data: { status: "CLOSED" } });
check("getOpenSeason returns null when nothing is open", (await getOpenSeason()) === null);
await prisma.season.update({ where: { id: season.id }, data: { status: "OPEN" } });

// Cleanup
await prisma.packageEvent.deleteMany({ where: { packageId: pkg.id } });
await prisma.package.delete({ where: { id: pkg.id } });
await prisma.order.delete({ where: { id: order.id } });
await prisma.fulfillmentMethod.delete({ where: { id: method.id } });
await prisma.season.delete({ where: { id: season.id } });
await prisma.customer.delete({ where: { id: customer.id } });
await prisma.product.delete({ where: { id: product.id } });
await reopenSeasons(prisma, previouslyOpen);
await prisma.$disconnect();

if (failures > 0) {
  console.error(`${failures} package-stage check(s) failed`);
  process.exit(1);
}
console.log("All package-stage checks passed");
