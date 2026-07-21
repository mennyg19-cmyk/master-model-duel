import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { notifyCustomer } from "@/lib/notifications";
import { LETTER, paginate, renderPdf, type PdfLine } from "@/lib/pdf";

// Pickup workflow (UR-010, G-017, G-026): readiness gated on inventory,
// ready-notification once, printable door list, unclaimed report, expiry cron.

/**
 * A pickup package is ready when the stock to fill it is physically on hand:
 * every tracked product/add-on it contains has quantityOnHand covering the
 * reservations (finalize reserved the units; readiness = the shelf caught up).
 * Untracked items are always ready.
 */
export async function isPackageStockReady(packageId: string): Promise<boolean> {
  const lines = await db.orderLine.findMany({
    where: { packageId },
    select: {
      product: { select: { inventoryItem: { select: { quantityOnHand: true, reserved: true } } } },
      addOns: { select: { addOn: { select: { inventoryItem: { select: { quantityOnHand: true, reserved: true } } } } } },
    },
  });
  const items = lines.flatMap((line) => [
    line.product.inventoryItem,
    ...line.addOns.map((addOn) => addOn.addOn.inventoryItem),
  ]);
  return items.every((item) => !item || item.quantityOnHand >= item.reserved);
}

async function pickupPackages(seasonId: string) {
  return db.package.findMany({
    where: {
      seasonId,
      fulfillmentMethod: { kind: "PICKUP" },
      stage: { not: "PICKED_UP" },
      lines: { some: {} },
    },
    include: {
      lines: {
        select: {
          quantity: true,
          product: { select: { name: true } },
          order: { select: { orderNumber: true, draftReference: true, customer: { select: { id: true, email: true, name: true, phone: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Sweep eligible pickups and capture the ready notification exactly once per
 * package. Stamp + notify commit together in one transaction: a failed
 * notification rolls the pickupReadyAt stamp back, so the next sweep retries
 * instead of skipping the customer forever. The guarded claim (updateMany on
 * pickupReadyAt null) makes two concurrent sweeps count each package once.
 */
export async function sendPickupReadyNotifications(seasonId: string) {
  const packages = await pickupPackages(seasonId);
  let readied = 0;
  let notified = 0;
  for (const pkg of packages.filter((entry) => !entry.pickupReadyAt && !entry.pickupExpiredAt)) {
    if (!(await isPackageStockReady(pkg.id))) continue;
    const outcome = await db.$transaction(async (tx) => {
      const claimed = await tx.package.updateMany({
        where: { id: pkg.id, pickupReadyAt: null, pickupExpiredAt: null },
        data: { pickupReadyAt: new Date() },
      });
      if (claimed.count === 0) return null;
      let captured = 0;
      const customers = new Map(pkg.lines.map((line) => [line.order.customer.id, line.order.customer]));
      for (const customer of customers.values()) {
        captured += await notifyCustomer(
          customer,
          {
            kind: "pickup_ready",
            subject: "Your Mishloach Manos order is ready for pickup",
            body: `${customer.name}, the package for ${pkg.recipientName} is packed and waiting at the pickup door.`,
            dedupeKey: `pickup-ready|${pkg.id}|${customer.id}`,
            packageId: pkg.id,
          },
          tx
        );
      }
      return captured;
    });
    if (outcome === null) continue;
    readied += 1;
    notified += outcome;
  }
  return { readied, notified };
}

/** Ready-and-waiting pickups (the door list) plus the unclaimed cut. */
export async function pickupBoard(seasonId: string) {
  const followupDays = await getSetting("orders.followup_days");
  const packages = await pickupPackages(seasonId);
  const now = Date.now();
  const board = packages.map((pkg) => ({
    id: pkg.id,
    recipientName: pkg.recipientName,
    stage: pkg.stage,
    version: pkg.version,
    pickupReadyAt: pkg.pickupReadyAt,
    pickupExpiredAt: pkg.pickupExpiredAt,
    customers: [...new Map(pkg.lines.map((line) => [line.order.customer.id, line.order.customer])).values()],
    orderRefs: [...new Set(pkg.lines.map((line) => (line.order.orderNumber ? `#${line.order.orderNumber}` : line.order.draftReference)))],
    items: pkg.lines.map((line) => `${line.quantity} x ${line.product.name}`),
    unclaimed:
      pkg.pickupReadyAt !== null &&
      pkg.pickupExpiredAt === null &&
      now - pkg.pickupReadyAt.getTime() > followupDays * 24 * 3600 * 1000,
  }));
  return { board, followupDays };
}

/** Letter door list: every ready pickup with a picked-up stamp box (G-026). */
export async function renderDoorList(seasonId: string): Promise<Buffer> {
  const { board } = await pickupBoard(seasonId);
  const ready = board.filter((entry) => entry.pickupReadyAt && !entry.pickupExpiredAt);
  const lines: PdfLine[] = [
    { text: "Pickup door list", size: 16, bold: true },
    { text: `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${ready.length} package(s) ready`, size: 9 },
  ];
  for (const entry of ready) {
    lines.push({ text: `[ ]  ${entry.recipientName}`, size: 12, bold: true, gapBefore: 12 });
    lines.push({ text: `Orders: ${entry.orderRefs.join(", ")} · For: ${entry.customers.map((customer) => customer.name).join(", ")}`, size: 9 });
    for (const item of entry.items) lines.push({ text: `  ${item}`, size: 9 });
    lines.push({ text: "Picked up by: ______________________  Date: __________", size: 9, gapBefore: 4 });
  }
  return renderPdf(paginate(lines, LETTER), LETTER);
}

/**
 * Pickup-expiry cron body (R-182 caller handles auth): pickups ready longer
 * than the expiry window and never claimed are stamped expired and surface on
 * the unclaimed report for the call center.
 */
export async function expireOverduePickups(seasonId: string, expiryDays: number) {
  const cutoff = new Date(Date.now() - expiryDays * 24 * 3600 * 1000);
  const overdue = await db.package.findMany({
    where: {
      seasonId,
      fulfillmentMethod: { kind: "PICKUP" },
      stage: { not: "PICKED_UP" },
      pickupReadyAt: { lt: cutoff },
      pickupExpiredAt: null,
    },
    select: { id: true, recipientName: true },
  });
  for (const pkg of overdue) {
    await db.$transaction(async (tx) => {
      await tx.package.update({ where: { id: pkg.id }, data: { pickupExpiredAt: new Date() } });
      await tx.packageAudit.create({
        data: { packageId: pkg.id, action: "pickup_expired", detail: { expiryDays } },
      });
    });
  }
  return { expired: overdue.length, expiredPackageIds: overdue.map((pkg) => pkg.id) };
}
