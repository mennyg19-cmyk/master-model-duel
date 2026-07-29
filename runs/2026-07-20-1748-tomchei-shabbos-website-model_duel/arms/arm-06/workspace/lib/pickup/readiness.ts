import { Package, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError } from "@/lib/errors";
import { sendNotification } from "@/lib/notify/outbox";
import { PackageEventAction } from "@/lib/packages/stages";
import { getSetting } from "@/lib/settings";
import { BRAND } from "@/lib/brand";

// UR-010/G-017: pickup readiness. A PICKUP package becomes eligible the
// moment its order's inventory is physically available — every inventory row
// backing its lines has no backorder debt (onHand >= 0; untracked products
// are available by definition). The ready notification sends ONCE per package
// (pickupReadyNotifiedAt), however many times the sweep runs.

export type PickupCandidate = Package & {
  order: { id: string; wireFormat: string | null; status: string; customer: { name: string; email: string; phone: string | null } };
  lines: { orderLine: { productId: string | null; addOnId: string | null } }[];
};

// Inventory availability: every InventoryItem row referenced by the package's
// lines must be out of backorder debt. Rows missing entirely (untracked
// products) gate nothing.
export async function hasAvailableInventory(pkg: PickupCandidate, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<boolean> {
  const productIds = pkg.lines.map((line) => line.orderLine.productId).filter((id): id is string => id !== null);
  const addOnIds = pkg.lines.map((line) => line.orderLine.addOnId).filter((id): id is string => id !== null);
  if (productIds.length === 0 && addOnIds.length === 0) return true;
  const rows = await client.inventoryItem.findMany({
    where: { OR: [{ productId: { in: productIds } }, { addOnId: { in: addOnIds } }] },
    select: { onHand: true },
  });
  return rows.every((row) => row.onHand >= 0);
}

const candidateInclude = {
  order: {
    select: {
      id: true,
      wireFormat: true,
      status: true,
      customer: { select: { name: true, email: true, phone: true } },
    },
  },
  lines: { select: { orderLine: { select: { productId: true, addOnId: true } } } },
} satisfies Prisma.PackageInclude;

export interface ReadinessSyncResult {
  candidates: number;
  markedReady: number;
}

// The readiness sweep — staff "check now" and the pickup cron both run this.
// Ready exactly once: pickupReadyAt is the guard, so a second sweep over the
// same package sends nothing.
export async function syncPickupReadiness(seasonId: string): Promise<ReadinessSyncResult> {
  const candidates: PickupCandidate[] = await prisma.package.findMany({
    where: {
      order: { seasonId, status: "FINALIZED" },
      channel: "PICKUP",
      stage: { not: "PICKED_UP" },
      pickupReadyAt: null,
    },
    include: candidateInclude,
    orderBy: { id: "asc" },
  });

  let markedReady = 0;
  for (const pkg of candidates) {
    if (!(await hasAvailableInventory(pkg))) continue;
    const readyAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.package.update({
        where: { id: pkg.id },
        data: { pickupReadyAt: readyAt, pickupReadyNotifiedAt: readyAt, version: { increment: 1 } },
      });
      const action: PackageEventAction = "pickup_ready";
      await tx.packageEvent.create({ data: { packageId: pkg.id, action } });
      await sendNotification(
        {
          kind: "pickup_ready",
          recipient: { email: pkg.order.customer.email, phone: pkg.order.customer.phone },
          subject: `${BRAND.orgName}: your order is ready for pickup`,
          body: `Hello ${pkg.order.customer.name},\n\nYour ${BRAND.orgName} order ${pkg.order.wireFormat ?? pkg.order.id} is ready for pickup. Package for ${pkg.recipientName} is waiting at the pickup location.\n\nThank you for supporting ${BRAND.orgName}.`,
          smsBody: `${BRAND.orgName}: order ${pkg.order.wireFormat ?? pkg.order.id} is ready for pickup.`,
          orderId: pkg.order.id,
          metadata: { packageId: pkg.id },
        },
        tx,
      );
    });
    markedReady += 1;
  }
  return { candidates: candidates.length, markedReady };
}

export interface PickupPolicy {
  unclaimedAfterDays: number;
  expireAfterDays: number;
}

export async function loadPickupPolicy(): Promise<PickupPolicy> {
  const policy = await getSetting("pickup.policy");
  if (!policy) {
    throw new DomainRuleError("pickup.policy is not configured; expected seeded unclaimed/expiry thresholds before running pickup sweeps");
  }
  return policy;
}

// The door list: ready packages still waiting for handout, oldest first —
// the order the door volunteer works through.
export async function loadDoorList(seasonId: string) {
  return prisma.package.findMany({
    where: {
      order: { seasonId, status: "FINALIZED" },
      channel: "PICKUP",
      stage: { not: "PICKED_UP" },
      pickupReadyAt: { not: null },
    },
    include: candidateInclude,
    orderBy: { pickupReadyAt: "asc" },
  });
}

// G-026 unclaimed report: ready longer than the policy threshold, still not
// picked up. Drives the admin report and the follow-up call center.
export async function loadUnclaimedPickups(seasonId: string, policy: PickupPolicy) {
  const threshold = new Date(Date.now() - policy.unclaimedAfterDays * 24 * 60 * 60 * 1000);
  return prisma.package.findMany({
    where: {
      order: { seasonId, status: "FINALIZED" },
      channel: "PICKUP",
      stage: { not: "PICKED_UP" },
      pickupReadyAt: { not: null, lt: threshold },
    },
    include: candidateInclude,
    orderBy: { pickupReadyAt: "asc" },
  });
}

export interface PickupSweepResult {
  cronRunId: string;
  readyMarked: number;
  expiredNotified: number;
  unclaimed: number;
}

// G-017/G-026 + R-182 cron body: readiness sync first (a restock flips
// eligibility in the same run), then the expiry pass — ready past
// expireAfterDays and still uncollected gets ONE come-get-it-or-contact-us
// notice (pickupExpiredNotifiedAt dedupe). Every run leaves a CronRun row.
export async function sweepPickupExpiry(seasonId: string): Promise<PickupSweepResult> {
  const policy = await loadPickupPolicy();
  const cronRun = await prisma.cronRun.create({ data: { name: "pickup-expiry" } });
  try {
    const readiness = await syncPickupReadiness(seasonId);

    const expireThreshold = new Date(Date.now() - policy.expireAfterDays * 24 * 60 * 60 * 1000);
    const expirable: PickupCandidate[] = await prisma.package.findMany({
      where: {
        order: { seasonId, status: "FINALIZED" },
        channel: "PICKUP",
        stage: { not: "PICKED_UP" },
        pickupReadyAt: { not: null, lt: expireThreshold },
        pickupExpiredNotifiedAt: null,
      },
      include: candidateInclude,
      orderBy: { id: "asc" },
    });

    let expiredNotified = 0;
    for (const pkg of expirable) {
      await prisma.$transaction(async (tx) => {
        await tx.package.update({
          where: { id: pkg.id },
          data: { pickupExpiredNotifiedAt: new Date(), version: { increment: 1 } },
        });
        const action: PackageEventAction = "pickup_expired";
        await tx.packageEvent.create({
          data: { packageId: pkg.id, action, metadata: { readyAt: pkg.pickupReadyAt?.toISOString() ?? null } },
        });
        await sendNotification(
          {
            kind: "pickup_expired",
            recipient: { email: pkg.order.customer.email },
            subject: `${BRAND.orgName}: your pickup is still waiting`,
            body: `Hello ${pkg.order.customer.name},\n\nYour ${BRAND.orgName} order ${pkg.order.wireFormat ?? pkg.order.id} has been ready for pickup since ${pkg.pickupReadyAt?.toISOString().slice(0, 10) ?? "recently"} and the pickup window has passed. Please contact us to arrange handoff.\n\nThank you for supporting ${BRAND.orgName}.`,
            orderId: pkg.order.id,
            metadata: { packageId: pkg.id },
          },
          tx,
        );
      });
      expiredNotified += 1;
    }

    const unclaimed = (await loadUnclaimedPickups(seasonId, policy)).length;
    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: {
        status: "OK",
        finishedAt: new Date(),
        message: `${readiness.markedReady} ready, ${expiredNotified} expired notices, ${unclaimed} unclaimed`,
      },
    });
    return { cronRunId: cronRun.id, readyMarked: readiness.markedReady, expiredNotified, unclaimed };
  } catch (error) {
    await prisma.cronRun.update({
      where: { id: cronRun.id },
      data: { status: "FAILED", finishedAt: new Date(), message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
