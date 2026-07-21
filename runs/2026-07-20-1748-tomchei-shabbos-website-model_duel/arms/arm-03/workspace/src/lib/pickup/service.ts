import { AuditAction, PackageStage } from "@prisma/client";
import { ApiError } from "@/lib/api-error";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { availableUnits } from "@/lib/inventory/reserve";
import { enqueueEmailAndSms } from "@/lib/notify/outbox";
import { transitionPackage } from "@/lib/orders/package-stages";

const DEFAULT_PICKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Inventory is "available" when every tracked product can cover its reservation. */
export async function orderInventoryAvailable(orderId: string): Promise<boolean> {
  const lines = await db.orderLine.findMany({
    where: { orderId },
    include: { product: { include: { inventory: true } } },
  });
  for (const line of lines) {
    if (!line.product.tracksInventory) continue;
    const inv = line.product.inventory;
    if (!inv) return false;
    // Unavailable when onHand cannot cover reserved (stock hole) or onHand is 0.
    if (inv.onHand <= 0) return false;
    if (inv.onHand < inv.reserved && availableUnits(inv) < 0) return false;
  }
  return true;
}

export async function markPickupReadyIfEligible(input: {
  seasonId: string;
  packageId: string;
  actorId?: string | null;
  ttlMs?: number;
}) {
  const pkg = await db.package.findFirst({
    where: { id: input.packageId, order: { seasonId: input.seasonId } },
    include: {
      fulfillmentMethod: true,
      order: { include: { customer: true } },
    },
  });
  if (!pkg) throw new ApiError("Package not found", 404);
  if (pkg.fulfillmentMethod.code.toUpperCase() !== "PICKUP") {
    throw new ApiError("Not a pickup package", 409);
  }
  if (pkg.pickedUpAt || pkg.stage === PackageStage.PICKED_UP) {
    throw new ApiError("Already picked up", 409);
  }

  const available = await orderInventoryAvailable(pkg.orderId);
  if (!available) {
    return { ready: false as const, reason: "inventory_unavailable" as const };
  }

  if (pkg.pickupReadyAt && pkg.pickupReadyNotifiedAt) {
    return { ready: true as const, already: true as const, package: pkg };
  }

  const expiresAt = new Date(Date.now() + (input.ttlMs ?? DEFAULT_PICKUP_TTL_MS));
  const updated = await db.package.update({
    where: { id: pkg.id },
    data: {
      pickupReadyAt: pkg.pickupReadyAt ?? new Date(),
      pickupExpiresAt: pkg.pickupExpiresAt ?? expiresAt,
    },
  });

  const customer = pkg.order.customer;
  const recipientKey =
    customer?.emailNorm || customer?.phoneNorm || customer?.id || pkg.orderId;
  const notify = await enqueueEmailAndSms({
    templateKey: "pickup-ready",
    recipientKey,
    idempotencyBase: `pickup-ready:${pkg.id}`,
    emailSubject: "Your order is ready for pickup",
    emailBody: `Package for ${pkg.recipientName} is ready at the door.`,
    smsBody: `TS: pickup ready for ${pkg.recipientName}.`,
    meta: { packageId: pkg.id, orderId: pkg.orderId },
    actorId: input.actorId,
  });

  const notified = await db.package.update({
    where: { id: pkg.id },
    data: {
      pickupReadyNotifiedAt: new Date(),
    },
  });

  await writeAudit({
    action: AuditAction.PICKUP_READY,
    actorId: input.actorId,
    meta: {
      packageId: pkg.id,
      orderId: pkg.orderId,
      notified: notify.email.created || notify.sms.created,
    },
  });

  return {
    ready: true as const,
    already: false as const,
    package: notified,
    notify,
    expiresAt: updated.pickupExpiresAt,
  };
}

export async function doorList(seasonId: string) {
  return db.package.findMany({
    where: {
      order: { seasonId },
      fulfillmentMethod: { code: "PICKUP" },
      pickupReadyAt: { not: null },
      pickedUpAt: null,
      stage: { not: PackageStage.PICKED_UP },
    },
    orderBy: { pickupReadyAt: "asc" },
    include: {
      order: { include: { customer: true } },
    },
  });
}

export async function stampPickedUp(input: {
  seasonId: string;
  packageId: string;
  actorId?: string | null;
}) {
  const pkg = await db.package.findFirst({
    where: { id: input.packageId, order: { seasonId: input.seasonId } },
  });
  if (!pkg) throw new ApiError("Package not found", 404);

  const advance: PackageStage[] = [];
  if (pkg.stage === PackageStage.NEW) {
    advance.push(PackageStage.PRINTED, PackageStage.PACKED, PackageStage.PICKED_UP);
  } else if (pkg.stage === PackageStage.PRINTED) {
    advance.push(PackageStage.PACKED, PackageStage.PICKED_UP);
  } else if (pkg.stage === PackageStage.PACKED) {
    advance.push(PackageStage.PICKED_UP);
  } else if (pkg.stage !== PackageStage.PICKED_UP) {
    throw new ApiError(`Cannot stamp from stage ${pkg.stage}`, 409);
  }

  for (const to of advance) {
    const result = await transitionPackage(
      input.seasonId,
      input.packageId,
      to,
      input.actorId,
    );
    if (!result.ok) {
      throw new ApiError(result.publicMessage, 409);
    }
  }

  const stamped = await db.package.update({
    where: { id: input.packageId },
    data: { pickedUpAt: new Date() },
  });
  await writeAudit({
    action: AuditAction.PICKUP_STAMPED,
    actorId: input.actorId,
    meta: { packageId: input.packageId },
  });
  return stamped;
}

export async function unclaimedPickupReport(seasonId: string) {
  const now = new Date();
  return db.package.findMany({
    where: {
      order: { seasonId },
      fulfillmentMethod: { code: "PICKUP" },
      pickupReadyAt: { not: null },
      pickedUpAt: null,
      OR: [
        { pickupExpiresAt: { lt: now } },
        {
          pickupReadyAt: { lt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) },
        },
      ],
    },
    include: { order: { include: { customer: true } } },
    orderBy: { pickupReadyAt: "asc" },
  });
}
