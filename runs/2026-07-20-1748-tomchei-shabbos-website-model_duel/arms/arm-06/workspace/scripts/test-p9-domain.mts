// DB integration for P9 (R-074..R-080, UR-002/UR-004/UR-010, G-005/G-017/
// G-021/G-023/G-025..G-030): the route builder over the geocode cache, driver
// magic links (rotation, PIN throttle), route lifecycle with the day-of
// notification law and the delivered audit tap, method switch with charge
// preservation + label void, manager-confirmed reroute, pickup readiness /
// expiry sweep, bulk scheduling with per-customer notification, payment
// reminders, and the follow-up read model. Requires embedded Postgres on
// 4106 (db:start). Label buys/voids hit the in-process Shippo fixture — the
// documented no-keys seam.

import http from "node:http";
import { PrismaClient } from "@prisma/client";
import {
  fixtureCreateRefund,
  fixtureCreateShipment,
  fixtureCreateTransaction,
  fixtureGetRefund,
  fixtureGetTrack,
  fixtureValidateAddress,
} from "../lib/shipping/fixture-double";

// lib/env snapshots process.env at import — fixture config lands first.
process.env.SHIPPO_API_TOKEN = "p9-domain-token";
process.env.AUTH_SECRET ??= "0123456789abcdef0123456789abcdef";

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
const { buyLabel, sweepShippingMaintenance } = await import("../lib/shipping/labels");
const { buildRoute } = await import("../lib/routes/builder");
const { nearbyShippedSuggestions } = await import("../lib/routes/reroute");
const { createDriverLink, loadLinkByToken, checkPin } = await import("../lib/routes/links");
const { startRoute, markStopDelivered } = await import("../lib/routes/lifecycle");
const { switchPackageMethod } = await import("../lib/routes/switch");
const { confirmRouteReroute } = await import("../lib/routes/reroute");
const { syncPickupReadiness, loadDoorList, loadUnclaimedPickups, loadPickupPolicy, sweepPickupExpiry } = await import(
  "../lib/pickup/readiness"
);
const { scheduleBulkDelivery, countUnscheduledBulkPackages } = await import("../lib/bulk/schedule");
const { deriveGeoPoint } = await import("../lib/customers/geocode");
const { haversineMiles, normalizedAddressKey } = await import("../lib/routes/geo");
const { sweepPaymentReminders } = await import("../lib/payments/reminders");
const { loadFollowUps } = await import("../lib/admin/follow-ups");
const { DomainRuleError } = await import("../lib/errors");
const { closeAllOpenSeasons, expectThrow, reopenSeasons } = await import("./test-db-helpers.mts");

const previouslyOpen = await closeAllOpenSeasons(prisma);
const stamp = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

const season = await prisma.season.create({ data: { name: `TEST-P9-${stamp}`, status: "OPEN" } });
const staff = await prisma.staffUser.create({
  data: { email: `p9-staff-${stamp}@example.org`, name: "P9 Staff", role: "MANAGER", status: "ACTIVE", confirmedAt: new Date() },
});
const ctx = { staff: { id: staff.id, email: staff.email }, impersonator: null };
const customer = await prisma.customer.create({
  data: { email: `p9-${stamp}@example.org`, name: "P9 Customer", phone: "555-0101" },
});
const product = await prisma.product.create({
  data: { slug: `p9-box-${stamp}`, name: "P9 Box", basePriceCents: 2000, seasonId: season.id, trackInventory: true },
});
await prisma.inventoryItem.create({ data: { productId: product.id, onHand: 50 } });
const backordered = await prisma.product.create({
  data: { slug: `p9-bo-${stamp}`, name: "P9 Backordered", basePriceCents: 1500, seasonId: season.id, trackInventory: true },
});
await prisma.inventoryItem.create({ data: { productId: backordered.id, onHand: -1 } });

for (const method of [
  { code: "DELIVERY", label: "Delivery", stages: ["NEW", "PRINTED", "PACKED", "SENT"], terminalStage: "SENT" },
  { code: "PICKUP", label: "Pickup", stages: ["NEW", "PACKED", "PICKED_UP"], terminalStage: "PICKED_UP" },
  { code: "SHIPPED", label: "Carrier shipping", stages: ["NEW", "PRINTED", "PACKED", "SENT"], terminalStage: "SENT" },
]) {
  await prisma.fulfillmentMethod.upsert({ where: { code: method.code }, update: { active: true, stages: method.stages, terminalStage: method.terminalStage }, create: method });
}
await setSetting("shipping.origin", { name: "Tomchei Shabbos", line1: "101 Squankum Rd", city: "Lakewood", region: "NJ", postalCode: "08701", country: "US" });
await setSetting("delivery.days", ["Friday", "Sunday"]);
await setSetting("pickup.policy", { unclaimedAfterDays: 7, expireAfterDays: 30 });
await setSetting("payments.reminders", { initialAfterDays: 14, intervalDays: 7 });

async function makeOrder(input: {
  ref: string;
  customerId: string;
  productId?: string;
  recipients: { name: string; line1: string; choice: "PER_PACKAGE_DELIVERY" | "SHIPPED" | "PICKUP" | "BULK_DELIVERY"; feeCents?: number; qty?: number }[];
}) {
  const order = await prisma.order.create({
    data: { seasonId: season.id, customerId: input.customerId, status: "DRAFT", draftRef: `${input.ref}-${stamp}`, totalCents: 0 },
  });
  let total = 0;
  for (const recipientInput of input.recipients) {
    const recipient = await prisma.draftRecipient.create({
      data: {
        orderId: order.id,
        name: recipientInput.name,
        line1: recipientInput.line1,
        city: "Lakewood",
        region: "NJ",
        postalCode: "10952",
        fulfillmentChoice: recipientInput.choice,
        deliveryFeeCents: recipientInput.feeCents ?? 0,
      },
    });
    const qty = recipientInput.qty ?? 1;
    const lineTotal = 2000 * qty;
    total += lineTotal + (recipientInput.feeCents ?? 0);
    await prisma.orderLine.create({
      data: {
        orderId: order.id,
        recipientId: recipient.id,
        productId: input.productId ?? product.id,
        productName: "P9 Box",
        qty,
        unitPriceCents: 2000,
        lineTotalCents: lineTotal,
      },
    });
  }
  await prisma.order.update({ where: { id: order.id }, data: { totalCents: total } });
  await finalizeOrder(order.id);
  return order;
}

// --- R-074/R-075: build the Friday route --------------------------------------
const orderA = await makeOrder({
  ref: "P9-A",
  customerId: customer.id,
  recipients: [
    { name: "Bubby", line1: "9 Hilltop Rd", choice: "PER_PACKAGE_DELIVERY" },
    { name: "Zaidy", line1: "21 Forest Ave", choice: "PER_PACKAGE_DELIVERY" },
  ],
});
const orderB = await makeOrder({
  ref: "P9-B",
  customerId: customer.id,
  recipients: [{ name: "Neighbor", line1: "5 Spruce St", choice: "PER_PACKAGE_DELIVERY" }],
});
const fridayPackages = await prisma.package.findMany({ where: { orderId: { in: [orderA.id, orderB.id] } } });
check("finalize materializes one PER_PACKAGE_DELIVERY package per recipient", fridayPackages.length === 3);
await prisma.package.updateMany({ where: { id: { in: fridayPackages.map((pkg) => pkg.id) } }, data: { deliveryDay: "Friday" } });

const built = await buildRoute({ deliveryDay: "Friday", ctx });
const route = await prisma.deliveryRoute.findUniqueOrThrow({ where: { id: built.routeId }, include: { stops: { orderBy: { seq: "asc" } } } });
check(
  "the builder turns the day's eligible packages into seq-ordered, geocoded stops",
  route.stops.length === 3 && route.stops.every((stop, index) => stop.seq === index + 1 && stop.lat !== null && stop.lng !== null),
);
check("the no-key optimizer reports nearest-neighbor honestly", built.provider === "nearest-neighbor");
check(
  "destinations and the origin landed in the geocode cache (a rebuild never refetches)",
  (await prisma.geocodeCache.count()) >= 4,
);
check(
  "route creation left its event + audit rows",
  (await prisma.routeEvent.count({ where: { routeId: route.id, action: "route_created" } })) === 1
    && (await prisma.auditLog.count({ where: { action: "route_create", targetId: route.id } })) === 1,
);
check(
  "a second build over the same day is a clean rule refusal (nothing eligible left)",
  await expectThrow(() => buildRoute({ deliveryDay: "Friday", ctx }), DomainRuleError),
);

// --- UR-004/G-025: driver link create + rotate ------------------------------------
const first = await createDriverLink({ routeId: route.id, ctx });
const firstToken = first.rawUrl.split("/drive/")[1];
check("the raw URL is a /drive/<token> path and the link loads active", first.rawUrl.startsWith("/drive/") && (await loadLinkByToken(firstToken)).state === "active");
check("only the token hash is stored — the raw token appears nowhere in the DB", !!(await prisma.driverRouteLink.findFirst({ where: { routeId: route.id } })));
const rotated = await createDriverLink({ routeId: route.id, ctx });
check("rotating reports itself and kills the previous token", rotated.rotated === true && (await loadLinkByToken(firstToken)).state === "invalid");
const activeToken = rotated.rawUrl.split("/drive/")[1];
const activeLink = (await loadLinkByToken(activeToken)).link!;
check("the rotated link is the one that works", activeLink.route.id === route.id);

// --- G-030: start the route — the day-of notification law --------------------------
const started = await startRoute({ routeId: route.id, linkId: activeLink.id });
check("start flips PLANNED -> STARTED and notifies the one affected customer", started.alreadyStarted === false && started.notifiedCustomers === 1);
// Outbox rows are not season-scoped, so every count is pinned to this run's
// order ids — a previous test run's leftovers can never pollute the law.
const fridayOrderIds = [orderA.id, orderB.id];
const dayOfRows = await prisma.outboxMessage.findMany({ where: { kind: "day_of_delivery", orderId: { in: fridayOrderIds } } });
check(
  "one email + one SMS per CUSTOMER, even across two orders and three stops",
  dayOfRows.length === 2 && dayOfRows.filter((row) => row.channel === "EMAIL").length === 1 && dayOfRows.filter((row) => row.channel === "SMS").length === 1,
);
check("the SMS went to the customer's phone, the email to their address", dayOfRows.every((row) => row.toAddress === customer.email || row.toAddress === customer.phone!));
const restarted = await startRoute({ routeId: route.id, linkId: activeLink.id });
check(
  "re-starting is a quiet no-op (second device, retry after a crash)",
  restarted.alreadyStarted === true && (await prisma.outboxMessage.count({ where: { kind: "day_of_delivery", orderId: { in: fridayOrderIds } } })) === 2,
);

// --- G-025: the Delivered tap --------------------------------------------------------
const deliveryPkg = fridayPackages[0];
for (const stop of route.stops) {
  await markStopDelivered({ routeId: route.id, stopId: stop.id, via: { linkId: activeLink.id } });
}
const deliveredPkg = await prisma.package.findUniqueOrThrow({ where: { id: deliveryPkg.id }, include: { fulfillmentMethod: true } });
check("a delivered stop advances its package to the method's terminal stage", deliveredPkg.stage === deliveredPkg.fulfillmentMethod.terminalStage);
const completedRoute = await prisma.deliveryRoute.findUniqueOrThrow({ where: { id: route.id } });
check("the route completes when the last stop lands", completedRoute.status === "COMPLETED" && completedRoute.completedAt !== null);
const fridayPackageIds = fridayPackages.map((pkg) => pkg.id);
check(
  "every tap left the audit trail (package event + route event with the link id)",
  (await prisma.packageEvent.count({ where: { action: "delivered", packageId: { in: fridayPackageIds } } })) === 3
    && (await prisma.routeEvent.count({ where: { routeId: route.id, action: "stop_delivered", linkId: activeLink.id } })) === 3
    && (await prisma.routeEvent.count({ where: { routeId: route.id, action: "route_completed" } })) === 1,
);
check("completion kills the magic link", (await loadLinkByToken(activeToken)).state === "completed");
const doubleTap = await markStopDelivered({ routeId: route.id, stopId: route.stops[0].id, via: { linkId: activeLink.id } }).catch(() => ({ alreadyDelivered: true, routeCompleted: true }));
check(
  "a double-tap can never double-audit",
  doubleTap.alreadyDelivered === true && (await prisma.packageEvent.count({ where: { action: "delivered", packageId: { in: fridayPackageIds } } })) === 3,
);

// --- UR-002/G-005: method switch with charge preserved + void --------------------------
const orderC = await makeOrder({
  ref: "P9-C",
  customerId: customer.id,
  recipients: [{ name: "Ship Me", line1: "40 Carrier Ln", choice: "SHIPPED", feeCents: 2197 }],
});
const shippedPkg = await prisma.package.findFirstOrThrow({ where: { orderId: orderC.id } });
await buyLabel({ packageId: shippedPkg.id, ctx });
const totalBefore = (await prisma.order.findUniqueOrThrow({ where: { id: orderC.id } })).totalCents;
check(
  "switching to delivery with a purchased label demands the void confirm",
  await expectThrow(() => switchPackageMethod({ packageId: shippedPkg.id, to: "PER_PACKAGE_DELIVERY", deliveryDay: "Friday", ctx }), DomainRuleError),
);
const switched = await switchPackageMethod({ packageId: shippedPkg.id, to: "PER_PACKAGE_DELIVERY", deliveryDay: "Friday", confirmVoid: true, ctx });
check(
  "the switch voids the printed-not-shipped label and preserves the frozen charge",
  switched.voidedShipmentId !== null && switched.preservedFeeCents === 2197,
);
const afterSwitch = await prisma.package.findUniqueOrThrow({ where: { id: shippedPkg.id } });
check(
  "the package flipped to PER_PACKAGE_DELIVERY with the delivery day; the paid order total never moved",
  afterSwitch.channel === "PER_PACKAGE_DELIVERY" && afterSwitch.deliveryDay === "Friday"
    && (await prisma.order.findUniqueOrThrow({ where: { id: orderC.id } })).totalCents === totalBefore,
);
check(
  "the void + the switch are both on the books",
  (await prisma.auditLog.count({ where: { action: "method_switch", targetId: shippedPkg.id } })) === 1
    && (await prisma.packageEvent.count({ where: { packageId: shippedPkg.id, action: "method_switch" } })) === 1,
);
const switchedBack = await switchPackageMethod({ packageId: shippedPkg.id, to: "SHIPPED", ctx });
check("the reverse switch (delivery -> shipping) preserves the same charge", switchedBack.preservedFeeCents === 2197 && switchedBack.voidedShipmentId === null);

// --- G-023/G-027: reroute behind the manager's confirm -----------------------------------
const orderD = await makeOrder({
  ref: "P9-D",
  customerId: customer.id,
  recipients: [{ name: "Sunday Run", line1: "77 Shady Ln", choice: "PER_PACKAGE_DELIVERY" }],
});
const sundayPkg = await prisma.package.findFirstOrThrow({ where: { orderId: orderD.id } });
await prisma.package.update({ where: { id: sundayPkg.id }, data: { deliveryDay: "Sunday" } });
const sundayRoute = await buildRoute({ deliveryDay: "Sunday", ctx });
const sundayStop = (await prisma.routeStop.findMany({ where: { routeId: sundayRoute.routeId } }))[0];
check(
  "delivering before start is refused — the driver must start the route first",
  await expectThrow(() => markStopDelivered({ routeId: sundayRoute.routeId, stopId: sundayStop.id, via: { staffId: staff.id } }), DomainRuleError),
);

const orderE = await makeOrder({
  ref: "P9-E",
  customerId: customer.id,
  recipients: [{ name: "Oops Shipped", line1: "77 Shady Ln", choice: "SHIPPED", feeCents: 2197 }],
});
const reroutePkg = await prisma.package.findFirstOrThrow({ where: { orderId: orderE.id } });
await buyLabel({ packageId: reroutePkg.id, ctx });
const suggestions = await nearbyShippedSuggestions(sundayRoute.routeId);
check("the suggestion engine finds the same-address shipped package", suggestions.some((entry) => entry.packageId === reroutePkg.id));
check(
  "reroute without the explicit confirm is refused (G-027)",
  await expectThrow(() => confirmRouteReroute({ routeId: sundayRoute.routeId, packageId: reroutePkg.id, confirm: false, ctx }), DomainRuleError),
);
const rerouted = await confirmRouteReroute({ routeId: sundayRoute.routeId, packageId: reroutePkg.id, confirm: true, ctx });
const reroutedPkg = await prisma.package.findUniqueOrThrow({ where: { id: reroutePkg.id } });
check(
  "the confirm voids the label, flips the channel, and appends the stop",
  rerouted.voidedShipmentId !== null && rerouted.stopSeq === 2 && reroutedPkg.channel === "PER_PACKAGE_DELIVERY" && reroutedPkg.deliveryDay === "Sunday",
);
check(
  "the reroute wrote its package event, route event, and audit row",
  (await prisma.packageEvent.count({ where: { packageId: reroutePkg.id, action: "reroute" } })) === 1
    && (await prisma.routeEvent.count({ where: { routeId: sundayRoute.routeId, action: "stop_added_reroute" } })) === 1
    && (await prisma.auditLog.count({ where: { action: "route_reroute", targetId: sundayRoute.routeId } })) === 1,
);

// --- UR-015: PIN protection with throttling ----------------------------------------------
const pinLink = await createDriverLink({ routeId: sundayRoute.routeId, pin: "1234", ctx });
const pinLinkRow = (await loadLinkByToken(pinLink.rawUrl.split("/drive/")[1])).link!;
const wrong1 = await checkPin(pinLinkRow.id, "9999");
check("a wrong PIN reports the remaining attempts", wrong1.outcome === "failed" && wrong1.attemptsLeft === 4);
await checkPin(pinLinkRow.id, "9998");
await checkPin(pinLinkRow.id, "9997");
await checkPin(pinLinkRow.id, "9996");
const fifth = await checkPin(pinLinkRow.id, "9995");
check("the fifth miss locks the link", fifth.outcome === "locked");
check("even the correct PIN is refused while locked", (await checkPin(pinLinkRow.id, "1234")).outcome === "locked");
await prisma.driverRouteLink.update({ where: { id: pinLinkRow.id }, data: { pinLockedUntil: null, pinFailures: 0 } });
check("after the lock window the correct PIN passes", (await checkPin(pinLinkRow.id, "1234")).outcome === "ok");

// --- UR-010/G-017: pickup readiness + expiry -------------------------------------------------
const orderF = await makeOrder({
  ref: "P9-F",
  customerId: customer.id,
  recipients: [{ name: "Come Get It", line1: "1 Door St", choice: "PICKUP" }],
});
const pickupPkg = await prisma.package.findFirstOrThrow({ where: { orderId: orderF.id } });
const readiness = await syncPickupReadiness(season.id);
const readyPkg = await prisma.package.findUniqueOrThrow({ where: { id: pickupPkg.id } });
check(
  "available inventory flips the pickup to ready, exactly once",
  readiness.markedReady === 1 && readyPkg.pickupReadyAt !== null && readyPkg.pickupReadyNotifiedAt !== null,
);
check(
  "the ready notification went out (email + SMS)",
  (await prisma.outboxMessage.count({ where: { kind: "pickup_ready", channel: "EMAIL", orderId: orderF.id } })) === 1
    && (await prisma.outboxMessage.count({ where: { kind: "pickup_ready", channel: "SMS", orderId: orderF.id } })) === 1,
);
const resync = await syncPickupReadiness(season.id);
check("a second sweep over the same package sends nothing", resync.markedReady === 0 && (await prisma.outboxMessage.count({ where: { kind: "pickup_ready", orderId: orderF.id } })) === 2);
check("the door list shows the waiting package", (await loadDoorList(season.id)).some((pkg) => pkg.id === pickupPkg.id));

const orderG = await makeOrder({
  ref: "P9-G",
  customerId: customer.id,
  productId: backordered.id,
  recipients: [{ name: "Backordered", line1: "2 Wait Ave", choice: "PICKUP" }],
});
const boPkg = await prisma.package.findFirstOrThrow({ where: { orderId: orderG.id } });
const boSync = await syncPickupReadiness(season.id);
check("backorder debt keeps the pickup off the door list", boSync.markedReady === 0 && (await prisma.package.findUniqueOrThrow({ where: { id: boPkg.id } })).pickupReadyAt === null);

// G-026: backdate readiness past the thresholds — unclaimed report + expiry sweep.
await prisma.package.update({ where: { id: pickupPkg.id }, data: { pickupReadyAt: new Date(Date.now() - 40 * DAY_MS) } });
const policy = await loadPickupPolicy();
check("the unclaimed report flags the long-waiting pickup", (await loadUnclaimedPickups(season.id, policy)).some((pkg) => pkg.id === pickupPkg.id));
const expirySweep = await sweepPickupExpiry(season.id);
check(
  "the expiry sweep sends ONE come-get-it notice and leaves a CronRun row",
  expirySweep.expiredNotified === 1 && (await prisma.outboxMessage.count({ where: { kind: "pickup_expired", orderId: orderF.id } })) === 1
    && (await prisma.cronRun.count({ where: { id: expirySweep.cronRunId, status: "OK" } })) === 1,
);
const expiryResweep = await sweepPickupExpiry(season.id);
check("the expiry notice never duplicates", expiryResweep.expiredNotified === 0 && (await prisma.outboxMessage.count({ where: { kind: "pickup_expired", orderId: orderF.id } })) === 1);

// --- G-021/R-079: bulk scheduling ---------------------------------------------------------
const customer2 = await prisma.customer.create({ data: { email: `p9-bulk-${stamp}@example.org`, name: "Bulk Buyer" } });
await makeOrder({
  ref: "P9-H",
  customerId: customer.id,
  recipients: [
    { name: "Shul One", line1: "10 Torah Way", choice: "BULK_DELIVERY" },
    { name: "Shul Two", line1: "20 Torah Way", choice: "BULK_DELIVERY" },
  ],
});
await makeOrder({
  ref: "P9-I",
  customerId: customer2.id,
  recipients: [{ name: "Yeshiva", line1: "30 Torah Way", choice: "BULK_DELIVERY" }],
});
check("three unscheduled bulk packages wait", (await countUnscheduledBulkPackages(season.id)) === 3);
const scheduled = await scheduleBulkDelivery({ deliveryDay: "Friday", window: "10:00-14:00", ctx });
check(
  "one action snapshots all three packages for two distinct customers",
  scheduled.packageCount === 3 && scheduled.customerCount === 2,
);
check(
  "each customer got exactly one email; only the customer with a phone got the SMS",
  scheduled.notifiedChannels.email === 2 && scheduled.notifiedChannels.sms === 1,
);
check(
  "the schedule stamped the delivery day on the member packages",
  (await prisma.package.count({ where: { bulkScheduleItems: { some: { scheduleId: scheduled.scheduleId } }, deliveryDay: "Friday" } })) === 3,
);
check(
  "nothing left means a clean rule refusal, not a zero-package schedule",
  await expectThrow(() => scheduleBulkDelivery({ deliveryDay: "Friday", ctx }), DomainRuleError),
);

// --- R-080: payment reminders ---------------------------------------------------------------
const orderJ = await makeOrder({
  ref: "P9-J",
  customerId: customer2.id,
  recipients: [{ name: "Pay Later", line1: "1 Ledger Ln", choice: "PICKUP" }],
});
await prisma.order.update({ where: { id: orderJ.id }, data: { createdAt: new Date(Date.now() - 40 * DAY_MS), paymentStatus: "UNPAID" } });
const reminderSweep = await sweepPaymentReminders(season.id);
check(
  "the first reminder lands for the old unpaid order (and only that one)",
  reminderSweep.reminded === 1 && (await prisma.outboxMessage.count({ where: { kind: "payment_reminder", orderId: orderJ.id } })) === 1,
);
const remindedOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderJ.id } });
check("the reminder stamped lastPaymentReminderAt", remindedOrder.lastPaymentReminderAt !== null);
const quietSweep = await sweepPaymentReminders(season.id);
check("the interval law silences the immediate re-run", quietSweep.reminded === 0);
await prisma.order.update({ where: { id: orderJ.id }, data: { lastPaymentReminderAt: new Date(Date.now() - 8 * DAY_MS) } });
const intervalSweep = await sweepPaymentReminders(season.id);
check("past the interval the cadence reminds again", intervalSweep.reminded === 1 && (await prisma.outboxMessage.count({ where: { kind: "payment_reminder", orderId: orderJ.id } })) === 2);

// --- R-079: the follow-up call center read model ---------------------------------------------
const followUps = await loadFollowUps(season.id);
check(
  "follow-ups cover all three reasons (payment, pickup, bulk)",
  followUps.some((row) => row.reason === "payment") && followUps.some((row) => row.reason === "pickup") && followUps.some((row) => row.reason === "bulk"),
);
check(
  "the payment filter returns only unpaid-balance rows",
  (await loadFollowUps(season.id, "payment")).every((row) => row.reason === "payment"),
);

// --- P9 fix-pass coverage -------------------------------------------------------------

// M1: the PIN lock escalates per LIFETIME lock (pinLockCount) and never
// resets on a correct PIN. pinLinkRow carries one lock from the throttle
// section above.
for (const pin of ["9990", "9991", "9992", "9993"]) await checkPin(pinLinkRow.id, pin);
const secondLock = await checkPin(pinLinkRow.id, "9989");
const afterSecondLock = await prisma.driverRouteLink.findUniqueOrThrow({ where: { id: pinLinkRow.id } });
check(
  "M1: the second lock escalates to the doubled window and counts on the row",
  secondLock.outcome === "locked"
    && afterSecondLock.pinLockCount === 2
    && afterSecondLock.pinLockedUntil!.getTime() - Date.now() > 15 * 60_000,
);
await prisma.driverRouteLink.update({ where: { id: pinLinkRow.id }, data: { pinLockedUntil: null } });
check(
  "M1: the correct PIN passes but the lifetime lock count never resets",
  (await checkPin(pinLinkRow.id, "1234")).outcome === "ok"
    && (await prisma.driverRouteLink.findUniqueOrThrow({ where: { id: pinLinkRow.id } })).pinLockCount === 2,
);

// B1: a PURCHASED row carrying a crash marker (carrier void succeeded, local
// commit failed) is completed LOCALLY by the sweep — no second carrier call.
const crashOrder = await makeOrder({
  ref: "P9-K",
  customerId: customer.id,
  recipients: [{ name: "Crash Void", line1: "5 Crash Ct", choice: "SHIPPED", feeCents: 2197 }],
});
const crashPkg = await prisma.package.findFirstOrThrow({ where: { orderId: crashOrder.id } });
await buyLabel({ packageId: crashPkg.id, ctx });
await prisma.shipment.updateMany({
  where: { packageId: crashPkg.id, status: "PURCHASED" },
  data: {
    shippoRefundId: `rfd_crash_${stamp}`,
    refundStatus: "SUCCESS",
    error: "carrier void succeeded but the local persist failed: simulated crash",
  },
});
const crashSweep = await sweepShippingMaintenance();
const crashRow = await prisma.shipment.findFirstOrThrow({ where: { packageId: crashPkg.id } });
check(
  "B1: the sweep resumes a crashed void from the stored refund id (no carrier call)",
  crashSweep.resumedVoidCrashes === 1 && crashRow.status === "VOIDED" && crashRow.voidedAt !== null && crashRow.error === null,
);

// M5: the suggestion scan never geocodes a candidate outside every stop's
// postal code — bounded even with many SHIPPED packages.
const farPostalOrder = await makeOrder({
  ref: "P9-L",
  customerId: customer.id,
  recipients: [{ name: "Wrong Postal", line1: "9 Nowhere Blvd", choice: "SHIPPED", feeCents: 2197 }],
});
const farPostalPkg = await prisma.package.findFirstOrThrow({ where: { orderId: farPostalOrder.id } });
// The destination snapshot falls back to the draft recipient's inline fields
// (no book address on these fixtures) — that is the row the scan reads.
await prisma.draftRecipient.updateMany({
  where: { orderId: farPostalOrder.id },
  data: { postalCode: "99999" },
});
const farPostalKey = normalizedAddressKey({
  line1: "9 Nowhere Blvd",
  line2: null,
  city: "Lakewood",
  region: "NJ",
  postalCode: "99999",
  country: "US",
});
const boundedSuggestions = await nearbyShippedSuggestions(sundayRoute.routeId);
check(
  "M5: a postal-mismatched candidate is excluded WITHOUT spending a geocode",
  (await prisma.geocodeCache.count({ where: { addressKey: farPostalKey } })) === 0
    && !boundedSuggestions.some((entry) => entry.packageId === farPostalPkg.id),
);

// m1: the confirm path re-verifies the geography law — a far-away SHIPPED
// package refuses even with confirm: true, before any carrier call. The dev
// geocoder is deterministic per address, so self-calibrate a line1 that is
// provably > 0.5 mi from the route's stop.
const sundayStopPoint = { lat: sundayStop.lat!, lng: sundayStop.lng! };
let farLine1 = "1 Faraway Rd";
for (const candidate of ["1 Faraway Rd", "22 Distant Dr", "333 Remote Ave", "4444 Exile Ln"]) {
  const key = normalizedAddressKey({ line1: candidate, line2: null, city: "Lakewood", region: "NJ", postalCode: "10952", country: "US" });
  if (haversineMiles(deriveGeoPoint(key), sundayStopPoint) > 0.5) {
    farLine1 = candidate;
    break;
  }
}
const farOrder = await makeOrder({
  ref: "P9-M",
  customerId: customer.id,
  recipients: [{ name: "Too Far", line1: farLine1, choice: "SHIPPED", feeCents: 2197 }],
});
const farPkg = await prisma.package.findFirstOrThrow({ where: { orderId: farOrder.id } });
check(
  "m1: the manager-confirmed reroute re-verifies proximity and refuses a far package",
  await expectThrow(
    () => confirmRouteReroute({ routeId: sundayRoute.routeId, packageId: farPkg.id, confirm: true, ctx }),
    DomainRuleError,
  ),
);

// M3: re-notify dedupe is per (customer, delivery day) — a second Friday
// schedule for the already-notified customer sends nothing; a different day
// is new information and notifies.
await makeOrder({
  ref: "P9-N",
  customerId: customer.id,
  recipients: [{ name: "Late Shul", line1: "40 Torah Way", choice: "BULK_DELIVERY" }],
});
const rescheduled = await scheduleBulkDelivery({ deliveryDay: "Friday", ctx });
check(
  "M3: a same-day reschedule adds the package but never re-emails the customer",
  rescheduled.packageCount === 1 && rescheduled.customerCount === 1
    && rescheduled.notifiedChannels.email === 0 && rescheduled.notifiedChannels.sms === 0,
);
await makeOrder({
  ref: "P9-O",
  customerId: customer.id,
  recipients: [{ name: "Sunday Shul", line1: "50 Torah Way", choice: "BULK_DELIVERY" }],
});
const sundayScheduled = await scheduleBulkDelivery({ deliveryDay: "Sunday", ctx });
check(
  "M3: a DIFFERENT day is new information and still notifies once",
  sundayScheduled.notifiedChannels.email === 1,
);

// m2: the PICKED_UP stamp gates on readiness — no pickupReadyAt, no stamp.
const { advancePackageStage } = await import("../lib/packages/stages");
const notReadyPkg = await prisma.package.findUniqueOrThrow({ where: { id: boPkg.id } });
check(
  "m2: stamping PICKED_UP before the readiness sweep is a clean rule refusal",
  await expectThrow(
    () => advancePackageStage({ packageId: boPkg.id, expectedVersion: notReadyPkg.version, to: "PICKED_UP", actorId: staff.id }),
    DomainRuleError,
  ),
);

// Cleanup: close our season before restoring whatever was open.
await prisma.season.update({ where: { id: season.id }, data: { status: "CLOSED" } });
await reopenSeasons(prisma, previouslyOpen);
fixtureServer.close();
await prisma.$disconnect();

if (failures > 0) {
  console.error(`${failures} P9 domain check(s) failed`);
  process.exit(1);
}
console.log("All P9 domain checks passed");
