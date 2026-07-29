// DB integration for P8 (R-055/UR-003/R-175/R-176/R-177/R-032): live Shippo
// quoting inside checkout submit, quote persistence, materialization of
// SHIPPED packages (guest address-key grouping), and the label lifecycle —
// buy with margin ledger, re-buy refusal, tracking refresh, void + re-buy,
// address validation refusal, and carrier failure compensation. Requires
// embedded Postgres on 4106 (db:start). Shippo API calls hit an in-process
// fixture server over real HTTP — the documented no-keys seam, same honesty
// class as the P5 Stripe fixture.

import http from "node:http";
import { PrismaClient } from "@prisma/client";
import {
  fixtureCreateRefund,
  fixtureCreateShipment,
  fixtureCreateTransaction,
  fixtureGetRefund,
  fixtureGetTrack,
  fixtureStats,
  fixtureValidateAddress,
} from "../lib/shipping/fixture-double";

// lib/env snapshots process.env at import, so the Shippo config must be set
// before any lib module loads — everything lib/* is dynamically imported
// after the fixture server is up.
process.env.SHIPPO_API_TOKEN = "p8-domain-token";

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

const fixtureServer = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = (chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}) as never;
    const url = new URL(req.url ?? "/", "http://fixture");
    let result: { status: number; payload: unknown };
    if (req.method === "POST" && url.pathname === "/shipments/") result = fixtureCreateShipment(body);
    else if (req.method === "POST" && url.pathname === "/transactions/") result = fixtureCreateTransaction(body);
    else if (req.method === "POST" && url.pathname === "/refunds/") result = fixtureCreateRefund(body);
    else if (req.method === "GET" && url.pathname.startsWith("/refunds/")) {
      result = fixtureGetRefund(decodeURIComponent(url.pathname.split("/")[2]));
    }
    else if (req.method === "POST" && url.pathname === "/addresses/") result = fixtureValidateAddress(body);
    else if (req.method === "GET" && url.pathname.startsWith("/tracks/")) {
      const parts = url.pathname.split("/");
      result = fixtureGetTrack(decodeURIComponent(parts[2]), decodeURIComponent(parts[3]));
    } else {
      result = { status: 404, payload: { detail: `unknown fixture path ${url.pathname}` } };
    }
    res.writeHead(result.status, { "content-type": "application/json" });
    res.end(JSON.stringify(result.payload));
  });
});
await new Promise<void>((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
process.env.SHIPPO_BASE_URL = `http://127.0.0.1:${(fixtureServer.address() as { port: number }).port}`;

const { setSetting } = await import("../lib/settings");
const { finalizeOrder } = await import("../lib/orders/state-machine");
const { submitCheckout } = await import("../lib/checkout/submit");
const { buyLabel, voidLabel, refreshTracking, sweepShippingMaintenance, forceResolveStuckPurchase } = await import(
  "../lib/shipping/labels"
);
const { DomainRuleError } = await import("../lib/errors");
const { closeAllOpenSeasons, expectThrow, reopenSeasons } = await import("./test-db-helpers.mts");

const previouslyOpen = await closeAllOpenSeasons(prisma);
const stamp = Date.now();

const season = await prisma.season.create({ data: { name: `TEST-P8-${stamp}`, status: "OPEN" } });
const staff = await prisma.staffUser.create({
  data: {
    email: `p8-staff-${stamp}@example.org`,
    name: "P8 Staff",
    role: "MANAGER",
    status: "ACTIVE",
    confirmedAt: new Date(),
  },
});
const ctx = { staff: { id: staff.id, email: staff.email }, impersonator: null };
const customer = await prisma.customer.create({
  data: { email: `p8-${stamp}@example.org`, name: "P8 Customer" },
});
const tracked = await prisma.product.create({
  data: {
    slug: `p8-box-${stamp}`,
    name: "P8 Box",
    basePriceCents: 2000,
    seasonId: season.id,
    trackInventory: true,
    lengthMm: 300,
    widthMm: 200,
    heightMm: 100,
    weightGrams: 1500,
  },
});
await prisma.inventoryItem.create({ data: { productId: tracked.id, onHand: 20 } });
await prisma.packageType.create({
  data: { name: `p8-type-${stamp}`, lengthMm: 300, widthMm: 200, heightMm: 100, weightGrams: 1500 },
});
await prisma.shipmentBox.create({
  data: { name: `p8-box-${stamp}`, lengthMm: 400, widthMm: 300, heightMm: 200, tareWeightGrams: 100 },
});
await prisma.fulfillmentMethod.upsert({
  where: { code: "SHIPPED" },
  update: { active: true, stages: ["NEW", "PRINTED", "PACKED", "SENT"], terminalStage: "SENT" },
  create: { code: "SHIPPED", label: "Carrier shipping", stages: ["NEW", "PRINTED", "PACKED", "SENT"], terminalStage: "SENT" },
});
await setSetting("shipping.origin", {
  name: "Tomchei Shabbos",
  line1: "101 Squankum Rd",
  city: "Lakewood",
  region: "NJ",
  postalCode: "08701",
  country: "US",
});

const bookAddress = await prisma.address.create({
  data: { customerId: customer.id, line1: "9 Hilltop Rd", city: "Lakewood", region: "NJ", postalCode: "10952" },
});

// Fixture math for one 1600g parcel to zip 10952 (default zone):
//   FedEx Ground (1450 + 2×120) × 1.3 = 2197 ← charge (highest ground)
//   UPS Ground   (1050 + 2×100) × 1.2 = 1500 ← buy (cheapest ground)
const CHARGE_CENTS = 2197;
const BUY_CENTS = 1500;

// --- R-032: submit freezes the live quote -------------------------------------
const order = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id, status: "DRAFT", draftRef: `P8-A-${stamp}`, totalCents: 0 },
});
const recipient = await prisma.draftRecipient.create({
  data: {
    orderId: order.id,
    name: "Bubby",
    line1: "9 Hilltop Rd",
    city: "Lakewood",
    region: "NJ",
    postalCode: "10952",
    addressId: bookAddress.id,
  },
});
await prisma.orderLine.create({
  data: { orderId: order.id, recipientId: recipient.id, productId: tracked.id, productName: "P8 Box", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
});

const summary = await submitCheckout(
  {
    draftRef: order.draftRef!,
    method: "card",
    greetingDefault: null,
    expectedTotalCents: 2000 + CHARGE_CENTS,
    recipients: [{ recipientId: recipient.id, fulfillmentChoice: "SHIPPED" }],
  },
  { customerId: customer.id },
);
check(
  "submit resolves the SHIPPED fee from a live quote and freezes it",
  summary !== null && summary.deliveryFeesCents === CHARGE_CENTS && summary.totalCents === 2000 + CHARGE_CENTS,
);
const frozenRecipient = await prisma.draftRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
check("the recipient snapshot carries the frozen fee", frozenRecipient.deliveryFeeCents === CHARGE_CENTS);
check(
  "the quote persisted as the order-scoped rate-lock record (R-155)",
  (await prisma.shippingQuote.count({ where: { orderId: order.id } })) >= 1,
);
check(
  "a stale expected total against the live quote is a 409-class conflict",
  await expectThrow(
    () =>
      submitCheckout(
        {
          draftRef: order.draftRef!,
          method: "card",
          greetingDefault: null,
          expectedTotalCents: 2000,
          recipients: [{ recipientId: recipient.id, fulfillmentChoice: "SHIPPED" }],
        },
        { customerId: customer.id },
      ),
    (await import("../lib/checkout/validate")).CheckoutConflictError,
  ),
);

// --- materialization (UR-001, SHIPPED channel) --------------------------------
await finalizeOrder(order.id);
const shippedPkg = await prisma.package.findFirstOrThrow({
  where: { orderId: order.id },
  include: { fulfillmentMethod: true },
});
check(
  "finalize materializes a SHIPPED package on the SHIPPED method stage list",
  shippedPkg.channel === "SHIPPED" && shippedPkg.fulfillmentMethod.code === "SHIPPED" && shippedPkg.stage === "NEW",
);

// --- R-055/UR-003: buy the label, margin ledger --------------------------------
const bought = await buyLabel({ packageId: shippedPkg.id, ctx });
check(
  "label purchase lands PURCHASED with tracking + label URL",
  bought.status === "PURCHASED" && bought.trackingNumber?.startsWith("1ZUPS") === true && bought.labelUrl !== null,
);
check(
  "the money law books charged − cost = margin (2197 − 1500 = 697)",
  bought.chargedCents === CHARGE_CENTS && bought.costCents === BUY_CENTS && bought.marginCents === 697,
);
check(
  "the buy went to the cheapest eligible carrier, not the one we charged on",
  bought.carrier === "ups" && bought.serviceLevel === "ups_ground",
);
check(
  "label_buy rode the package event trail and the staff audit log",
  (await prisma.packageEvent.count({ where: { packageId: shippedPkg.id, action: "label_buy" } })) === 1
    && (await prisma.auditLog.count({ where: { action: "label_buy", targetId: shippedPkg.id } })) === 1,
);
check(
  "m13: the label buy writes NO ShippingQuote row (rate-lock rows are the checkout path's record)",
  (await prisma.shippingQuote.count({ where: { packageId: shippedPkg.id } })) === 0,
);
check(
  "m12: the carrier-side shipment id landed on the row for traceability",
  bought.shippoShipmentId !== null && bought.shippoShipmentId.startsWith("shp_"),
);
check(
  "one active label per package — a second buy is a clean rule refusal",
  await expectThrow(() => buyLabel({ packageId: shippedPkg.id, ctx }), DomainRuleError),
);

// --- tracking refresh ----------------------------------------------------------
const trackedShipment = await refreshTracking({ packageId: shippedPkg.id, ctx });
check("tracking refresh pulls the carrier status onto the row", trackedShipment.trackingStatus === "TRANSIT");

// --- R-176: void then re-buy ----------------------------------------------------
const voided = await voidLabel({ packageId: shippedPkg.id, ctx, reason: "re-rate probe" });
check("void flips the row to VOIDED with a timestamp", voided.status === "VOIDED" && voided.voidedAt !== null);
check(
  "the void wrote its audit row",
  (await prisma.auditLog.count({ where: { action: "label_void", targetId: shippedPkg.id } })) === 1,
);
const rebought = await buyLabel({ packageId: shippedPkg.id, ctx });
check("a voided package can buy again (re-quoted live)", rebought.status === "PURCHASED" && rebought.id !== bought.id);

// --- R-177: address validation refuses before money moves -----------------------
const badOrder = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id, status: "DRAFT", draftRef: `P8-B-${stamp}`, totalCents: 3000 },
});
const badRecipient = await prisma.draftRecipient.create({
  data: {
    orderId: badOrder.id,
    name: "Nobody Here",
    line1: "13 BADADDR Way",
    city: "Lakewood",
    region: "NJ",
    postalCode: "10952",
    fulfillmentChoice: "SHIPPED",
    deliveryFeeCents: 1000,
  },
});
await prisma.orderLine.create({
  data: { orderId: badOrder.id, recipientId: badRecipient.id, productId: tracked.id, productName: "P8 Box", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
});
await finalizeOrder(badOrder.id);
const badPkg = await prisma.package.findFirstOrThrow({ where: { orderId: badOrder.id } });
check(
  "an undeliverable address refuses the buy with a domain error (no money moved)",
  await expectThrow(() => buyLabel({ packageId: badPkg.id, ctx }), DomainRuleError),
);
check(
  "the failed validation landed on the event trail; no shipment row exists",
  (await prisma.packageEvent.count({ where: { packageId: badPkg.id, action: "address_validate" } })) === 1
    && (await prisma.shipment.count({ where: { packageId: badPkg.id } })) === 0,
);

// --- R-175: carrier failure compensates honestly --------------------------------
const failOrder = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id, status: "DRAFT", draftRef: `P8-C-${stamp}`, totalCents: 4197 },
});
const failRecipient = await prisma.draftRecipient.create({
  data: {
    orderId: failOrder.id,
    name: "Bad Account",
    line1: "7 FAILBUY Ct",
    city: "Lakewood",
    region: "NJ",
    postalCode: "10952",
    fulfillmentChoice: "SHIPPED",
    deliveryFeeCents: 2197,
  },
});
await prisma.orderLine.create({
  data: { orderId: failOrder.id, recipientId: failRecipient.id, productId: tracked.id, productName: "P8 Box", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
});
await finalizeOrder(failOrder.id);
const failPkg = await prisma.package.findFirstOrThrow({ where: { orderId: failOrder.id } });
const { LabelPurchaseError } = await import("../lib/shipping/labels");
check(
  "a carrier-declined purchase raises the typed label error",
  await expectThrow(() => buyLabel({ packageId: failPkg.id, ctx }), LabelPurchaseError),
);
const failedShipment = await prisma.shipment.findFirstOrThrow({ where: { packageId: failPkg.id } });
const failOrderAfter = await prisma.order.findUniqueOrThrow({ where: { id: failOrder.id } });
check(
  "R-175: the failure is recorded with the carrier's reason; the paid order is never mutated",
  failedShipment.status === "FAILED" && failedShipment.error !== null && failOrderAfter.totalCents === 4197,
);
check(
  "the label_failed event explains the attempt",
  (await prisma.packageEvent.count({ where: { packageId: failPkg.id, action: "label_failed" } })) === 1,
);

// --- guest grouping + inline-snapshot destination -------------------------------
const guestOrder = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id, status: "DRAFT", draftRef: `P8-D-${stamp}`, totalCents: 6000 },
});
const twinA = await prisma.draftRecipient.create({
  data: {
    orderId: guestOrder.id,
    name: "Guest Twins",
    line1: "1 First St",
    city: "Lakewood",
    region: "NJ",
    postalCode: "10952",
    fulfillmentChoice: "SHIPPED",
    deliveryFeeCents: 2197,
  },
});
const twinB = await prisma.draftRecipient.create({
  data: {
    orderId: guestOrder.id,
    name: "Guest Twins",
    line1: "99 Second Ave",
    city: "Monsey",
    region: "NY",
    postalCode: "10952",
    fulfillmentChoice: "SHIPPED",
    deliveryFeeCents: 2197,
  },
});
await prisma.orderLine.create({
  data: { orderId: guestOrder.id, recipientId: twinA.id, productId: tracked.id, productName: "P8 Box", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
});
await prisma.orderLine.create({
  data: { orderId: guestOrder.id, recipientId: twinB.id, productId: tracked.id, productName: "P8 Box", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
});
await finalizeOrder(guestOrder.id);
const guestPackages = await prisma.package.findMany({ where: { orderId: guestOrder.id } });
check(
  "same-named guests at different addresses never merge into one label (address-key grouping)",
  guestPackages.length === 2,
);
const guestBuy = await buyLabel({ packageId: guestPackages[0].id, ctx });
check(
  "a book-less guest package buys its label from the recipient's inline address snapshot",
  guestBuy.status === "PURCHASED",
);

// --- E1#3: the west zone flips which carrier is high ------------------------------
// Zip 90210 prices UPS 1.9x (2375) above FedEx (1690) — charge/buy must
// follow the math, not a hardcoded carrier.
const westOrder = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id, status: "DRAFT", draftRef: `P8-E-${stamp}`, totalCents: 4375 },
});
const westRecipient = await prisma.draftRecipient.create({
  data: {
    orderId: westOrder.id,
    name: "West Coast",
    line1: "100 Sunset Blvd",
    city: "Los Angeles",
    region: "CA",
    postalCode: "90210",
    fulfillmentChoice: "SHIPPED",
    deliveryFeeCents: 2375,
  },
});
await prisma.orderLine.create({
  data: { orderId: westOrder.id, recipientId: westRecipient.id, productId: tracked.id, productName: "P8 Box", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
});
await finalizeOrder(westOrder.id);
const westPkg = await prisma.package.findFirstOrThrow({ where: { orderId: westOrder.id } });
// R-155: an expired quote row with garbage options must never be reused —
// the buy re-quotes live.
await prisma.shippingQuote.create({
  data: {
    packageId: westPkg.id,
    options: { rates: [], charge: { amountCents: 1 }, buy: { rateId: "rate_garbage" } },
    expiresAt: new Date(Date.now() - 60_000),
  },
});
const westBuy = await buyLabel({ packageId: westPkg.id, ctx });
check(
  "the west zone flips charge AND buy (charge UPS 2375, buy FedEx 1690, margin 685)",
  westBuy.chargedCents === 2375 && westBuy.costCents === 1690 && westBuy.marginCents === 685 && westBuy.carrier === "fedex",
);
check("the expired garbage quote was ignored (cost is the live fixture price)", westBuy.costCents === 1690);

// --- E3: void guard follows the unshipped window ---------------------------------
// PRINTED (not shipped): void succeeds. SENT (terminal): void + buy refused.
const { advancePackageStage } = await import("../lib/packages/stages");
await advancePackageStage({ packageId: westPkg.id, expectedVersion: 1, to: "PRINTED", actorId: staff.id });
const voidAtPrinted = await voidLabel({ packageId: westPkg.id, ctx, reason: "address fix before dispatch" });
check("void succeeds while the package is PRINTED (still ours)", voidAtPrinted.status === "VOIDED");
await buyLabel({ packageId: westPkg.id, ctx });
await advancePackageStage({ packageId: westPkg.id, expectedVersion: 2, to: "PACKED", actorId: staff.id });
await advancePackageStage({ packageId: westPkg.id, expectedVersion: 3, to: "SENT", actorId: staff.id });
check(
  "once SENT the carrier has it — void is refused",
  await expectThrow(() => voidLabel({ packageId: westPkg.id, ctx }), DomainRuleError),
);
check(
  "once SENT a fresh buy is refused too",
  await expectThrow(() => buyLabel({ packageId: westPkg.id, ctx }), DomainRuleError),
);
// B1: at SENT the carrier has the package — tracking refresh is the live
// operation there and must NOT hit the terminal-stage guard.
const trackingAtSent = await refreshTracking({ packageId: westPkg.id, ctx });
check(
  "B1: tracking refresh works at SENT (the only stage where it matters)",
  trackingAtSent.trackingStatus === "TRANSIT",
);

// --- M5: a merged SHIPPED package keeps a per-recipient charge ledger --------
// Two guests at the SAME address merge into one package; each froze their own
// checkout quote. The label buy must record the per-recipient split so P12
// can separate the honest spread from the combined-parcel packing artifact.
const mergeOrder = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id, status: "DRAFT", draftRef: `P8-M-${stamp}`, totalCents: 8394 },
});
const mergeA = await prisma.draftRecipient.create({
  data: {
    orderId: mergeOrder.id,
    name: "Merge Pair",
    line1: "5 Merge Ln",
    city: "Lakewood",
    region: "NJ",
    postalCode: "10952",
    fulfillmentChoice: "SHIPPED",
    deliveryFeeCents: 2197,
  },
});
const mergeB = await prisma.draftRecipient.create({
  data: {
    orderId: mergeOrder.id,
    name: "Merge Pair",
    line1: "5 Merge Ln",
    city: "Lakewood",
    region: "NJ",
    postalCode: "10952",
    fulfillmentChoice: "SHIPPED",
    deliveryFeeCents: 2197,
  },
});
await prisma.orderLine.create({
  data: { orderId: mergeOrder.id, recipientId: mergeA.id, productId: tracked.id, productName: "P8 Box", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
});
await prisma.orderLine.create({
  data: { orderId: mergeOrder.id, recipientId: mergeB.id, productId: tracked.id, productName: "P8 Box", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
});
await finalizeOrder(mergeOrder.id);
const mergedPackages = await prisma.package.findMany({ where: { orderId: mergeOrder.id } });
check("same-named guests at the same address merge into one package", mergedPackages.length === 1);
const mergedBuy = await buyLabel({ packageId: mergedPackages[0].id, ctx });
const mergedBreakdown = (mergedBuy.chargeBreakdown ?? []) as { recipientId: string; chargedCents: number }[];
check(
  "M5: the charge sums both frozen quotes and the split is on the row",
  mergedBuy.chargedCents === 4394 && mergedBreakdown.length === 2
    && mergedBreakdown.every((member) => member.chargedCents === 2197),
);
check(
  "M5: cost prices the combined-parcel shipment and the margin is the honest blend",
  mergedBuy.costCents === 1740 && mergedBuy.marginCents === 4394 - 1740,
);
const mergedEvent = await prisma.packageEvent.findFirstOrThrow({
  where: { packageId: mergedPackages[0].id, action: "label_buy" },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
});
const mergedMeta = mergedEvent.metadata as { mergedMembers?: number; marginNote?: string };
check(
  "M5: the label_buy event flags the merge so reconciliation reads it correctly",
  mergedMeta.mergedMembers === 2 && typeof mergedMeta.marginNote === "string",
);

// --- M4: the echoed cost is cross-checked against the selected rate ----------
// DRIFTBUY: the carrier sale succeeds but echoes +$1.00 over the quoted rate.
const driftOrder = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id, status: "DRAFT", draftRef: `P8-R-${stamp}`, totalCents: 4197 },
});
const driftRecipient = await prisma.draftRecipient.create({
  data: {
    orderId: driftOrder.id,
    name: "Drift Buyer",
    line1: "3 DRIFTBUY Dr",
    city: "Lakewood",
    region: "NJ",
    postalCode: "10952",
    fulfillmentChoice: "SHIPPED",
    deliveryFeeCents: 2197,
  },
});
await prisma.orderLine.create({
  data: { orderId: driftOrder.id, recipientId: driftRecipient.id, productId: tracked.id, productName: "P8 Box", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
});
await finalizeOrder(driftOrder.id);
const driftPkg = await prisma.package.findFirstOrThrow({ where: { orderId: driftOrder.id } });
const driftBuy = await buyLabel({ packageId: driftPkg.id, ctx });
check(
  "M4: the echoed cost books honestly even when it drifts from the quote",
  driftBuy.costCents === 1600 && driftBuy.marginCents === 2197 - 1600,
);
const driftEvent = await prisma.packageEvent.findFirstOrThrow({
  where: { packageId: driftPkg.id, action: "label_buy" },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
});
const driftMeta = driftEvent.metadata as { quotedCostCents?: number; costDriftCents?: number };
check(
  "M4: the drift is flagged on the event, not silently absorbed into margin",
  driftMeta.quotedCostCents === 1500 && driftMeta.costDriftCents === 100,
);

// --- M2: an ultimately-declined void reverts to PURCHASED via the sweep ------
// FAILREFUND: the refund queues, then the carrier declines it (label already
// scanned into the network). The sweep must not leave the ledger optimistic.
const refundOrder = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id, status: "DRAFT", draftRef: `P8-V-${stamp}`, totalCents: 4197 },
});
const refundRecipient = await prisma.draftRecipient.create({
  data: {
    orderId: refundOrder.id,
    name: "Late Scan",
    line1: "8 FAILREFUND Pl",
    city: "Lakewood",
    region: "NJ",
    postalCode: "10952",
    fulfillmentChoice: "SHIPPED",
    deliveryFeeCents: 2197,
  },
});
await prisma.orderLine.create({
  data: { orderId: refundOrder.id, recipientId: refundRecipient.id, productId: tracked.id, productName: "P8 Box", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
});
await finalizeOrder(refundOrder.id);
const refundPkg = await prisma.package.findFirstOrThrow({ where: { orderId: refundOrder.id } });
await buyLabel({ packageId: refundPkg.id, ctx });
const queuedVoid = await voidLabel({ packageId: refundPkg.id, ctx, reason: "probe the async settle" });
check(
  "M2: a queued refund is recorded on the row with its refund object id",
  queuedVoid.status === "VOIDED" && queuedVoid.refundStatus === "QUEUED" && queuedVoid.shippoRefundId !== null,
);
const refundSweep = await sweepShippingMaintenance();
const reverted = await prisma.shipment.findFirstOrThrow({ where: { id: queuedVoid.id } });
check(
  "M2: the sweep reverts a carrier-declined void to PURCHASED (the label is still live and paid)",
  refundSweep.rejectedVoids >= 1 && reverted.status === "PURCHASED" && reverted.refundStatus === "ERROR" && reverted.voidedAt === null,
);
check(
  "M2: the rejection landed on the event trail",
  (await prisma.packageEvent.count({ where: { packageId: refundPkg.id, action: "label_void_rejected" } })) === 1,
);

// --- M1: stuck PURCHASING rows resolve honestly --------------------------------
const stuckOrder = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id, status: "DRAFT", draftRef: `P8-S-${stamp}`, totalCents: 4197 },
});
const stuckRecipient = await prisma.draftRecipient.create({
  data: {
    orderId: stuckOrder.id,
    name: "Stuck Buyer",
    line1: "21 Stuck Ln",
    city: "Lakewood",
    region: "NJ",
    postalCode: "10952",
    fulfillmentChoice: "SHIPPED",
    deliveryFeeCents: 2197,
  },
});
await prisma.orderLine.create({
  data: { orderId: stuckOrder.id, recipientId: stuckRecipient.id, productId: tracked.id, productName: "P8 Box", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
});
await finalizeOrder(stuckOrder.id);
const stuckPkg = await prisma.package.findFirstOrThrow({ where: { orderId: stuckOrder.id } });

// Leg 1 — staff force-resolve a fresh stuck row the sweep's TTL hasn't reached.
await prisma.shipment.create({ data: { packageId: stuckPkg.id, status: "PURCHASING", chargedCents: 2197 } });
const forced = await forceResolveStuckPurchase({ packageId: stuckPkg.id, ctx });
check(
  "M1: staff force-resolve fails an unconfirmed stuck purchase so the package can buy again",
  forced.status === "FAILED",
);
check(
  "M1: force-resolve with nothing stuck is a clean rule refusal",
  await expectThrow(() => forceResolveStuckPurchase({ packageId: stuckPkg.id, ctx }), DomainRuleError),
);

// Leg 2 — a stale row with no carrier transaction id sweeps to FAILED.
await prisma.shipment.create({
  data: { packageId: stuckPkg.id, status: "PURCHASING", chargedCents: 2197, createdAt: new Date(Date.now() - 60 * 60_000) },
});
const stuckSweep = await sweepShippingMaintenance();
const sweptFailed = await prisma.shipment.findFirstOrThrow({
  where: { packageId: stuckPkg.id, status: "FAILED" },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
});
check(
  "M1: the sweep fails a stale PURCHASING row the carrier never confirmed",
  stuckSweep.failedPurchases >= 1 && sweptFailed.error !== null,
);

// Leg 3 — a stale row WITH a carrier transaction id was a real sale: the sweep
// completes the purchase instead of mislabeling it failed (M8's recovery leg).
await prisma.shipment.create({
  data: {
    packageId: stuckPkg.id,
    status: "PURCHASING",
    chargedCents: 2197,
    shippoTransactionId: "txn_stuck_recovered",
    createdAt: new Date(Date.now() - 60 * 60_000),
  },
});
const recoverSweep = await sweepShippingMaintenance();
const recovered = await prisma.shipment.findFirstOrThrow({ where: { packageId: stuckPkg.id, status: "PURCHASED" } });
check(
  "M1/M8: the sweep completes a stuck purchase the carrier DID confirm",
  recoverSweep.recoveredPurchases >= 1 && recovered.shippoTransactionId === "txn_stuck_recovered",
);
const recoveredEvent = await prisma.packageEvent.findFirstOrThrow({
  where: { packageId: stuckPkg.id, action: "label_buy" },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
});
check(
  "M1: the recovery is flagged on the event trail",
  (recoveredEvent.metadata as { recoveredFromStuckPurchase?: boolean }).recoveredFromStuckPurchase === true,
);

// --- M6/M9: display quotes carry line2 and cache per order+recipient ---------
const { quoteCheckoutShipping } = await import("../lib/checkout/shipping-quotes");
const quoteOrder = await prisma.order.create({
  data: { seasonId: season.id, customerId: customer.id, status: "DRAFT", draftRef: `P8-Q-${stamp}`, totalCents: 0 },
});
const quoteRecipient = await prisma.draftRecipient.create({
  data: {
    orderId: quoteOrder.id,
    name: "Apt Resident",
    line1: "12 Quoter Rd",
    line2: "Apt 4",
    city: "Lakewood",
    region: "NJ",
    postalCode: "10952",
  },
});
await prisma.orderLine.create({
  data: { orderId: quoteOrder.id, recipientId: quoteRecipient.id, productId: tracked.id, productName: "P8 Box", qty: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
});
const statsBefore = fixtureStats.shipmentsCreated;
const displayQuotes = await quoteCheckoutShipping({
  orderId: quoteOrder.id,
  recipients: [
    {
      id: quoteRecipient.id,
      name: quoteRecipient.name,
      line1: quoteRecipient.line1,
      line2: quoteRecipient.line2,
      city: quoteRecipient.city,
      region: quoteRecipient.region,
      postalCode: quoteRecipient.postalCode,
      country: quoteRecipient.country,
    },
  ],
});
check(
  "the display quote prices the SHIPPED option for the page",
  displayQuotes[quoteRecipient.id]?.available === true
    && (displayQuotes[quoteRecipient.id] as { chargedCents: number }).chargedCents === 2197,
);
check(
  "M6: line2 rides the quote destination (quote and label see the same address)",
  fixtureStats.lastShipmentTo?.street2 === "Apt 4",
);
await quoteCheckoutShipping({
  orderId: quoteOrder.id,
  recipients: [
    {
      id: quoteRecipient.id,
      name: quoteRecipient.name,
      line1: quoteRecipient.line1,
      line2: quoteRecipient.line2,
      city: quoteRecipient.city,
      region: quoteRecipient.region,
      postalCode: quoteRecipient.postalCode,
      country: quoteRecipient.country,
    },
  ],
});
check(
  "M9: a checkout re-render inside the TTL spends zero additional carrier calls",
  fixtureStats.shipmentsCreated === statsBefore + 1,
);

// Cleanup: close our season before restoring whatever was open.
await prisma.season.update({ where: { id: season.id }, data: { status: "CLOSED" } });
await reopenSeasons(prisma, previouslyOpen);
fixtureServer.close();
await prisma.$disconnect();

if (failures > 0) {
  console.error(`${failures} P8 domain check(s) failed`);
  process.exit(1);
}
console.log("All P8 domain checks passed");
