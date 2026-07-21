import {
  AuditAction,
  PackageStage,
  Prisma,
  ShippingLabelStatus,
} from "@prisma/client";
import { ApiError } from "@/lib/api-error";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { buyLabel, trackShipment, validateAddress, voidLabel } from "@/lib/shippo/client";
import { quoteMargin } from "@/lib/shipping/margin";
import {
  computePackageShipmentPlan,
  planToParcels,
  type ShipmentPlan,
} from "@/lib/shipping/bin-packing";

function labelBuyIdempotencyKey(packageId: string): string {
  return `label-buy:${packageId}`;
}

function labelAuditMeta(
  label: {
    id: string;
    packageId: string;
    orderId: string;
    carrier?: string;
    chargedCents?: number;
    purchasedCents?: number;
    marginCents?: number;
    trackingNumber?: string | null;
  },
  extra?: Record<string, unknown>,
): Prisma.InputJsonValue {
  return {
    labelId: label.id,
    packageId: label.packageId,
    orderId: label.orderId,
    ...(label.carrier != null ? { carrier: label.carrier } : {}),
    ...(label.chargedCents != null ? { chargedCents: label.chargedCents } : {}),
    ...(label.purchasedCents != null ? { purchasedCents: label.purchasedCents } : {}),
    ...(label.marginCents != null ? { marginCents: label.marginCents } : {}),
    ...(label.trackingNumber != null ? { trackingNumber: label.trackingNumber } : {}),
    ...extra,
  };
}

function toAddress(pkg: {
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}) {
  return {
    name: pkg.recipientName,
    street1: pkg.addressLine1,
    street2: pkg.addressLine2,
    city: pkg.city,
    state: pkg.state,
    zip: pkg.postalCode,
    country: pkg.country || "US",
  };
}

/** Active purchased label that is still voidable (printed-but-unshipped / pre-route). */
export function isVoidable(label: {
  status: ShippingLabelStatus;
  routeAssignedAt: Date | null;
}): boolean {
  return label.status === ShippingLabelStatus.PURCHASED && label.routeAssignedAt == null;
}

export async function createLabelForPackage(input: {
  packageId: string;
  actorId?: string | null;
  seasonId?: string;
}): Promise<{
  label: Awaited<ReturnType<typeof db.shippingLabel.create>>;
  margin: Awaited<ReturnType<typeof quoteMargin>>;
  plan: ShipmentPlan;
}> {
  const pkg = await db.package.findFirst({
    where: {
      id: input.packageId,
      ...(input.seasonId ? { order: { seasonId: input.seasonId } } : {}),
    },
    include: {
      fulfillmentMethod: true,
      items: { include: { orderLine: { include: { product: true } } } },
    },
  });
  if (!pkg) throw new ApiError("Package not found", 404);
  if (pkg.fulfillmentMethod.code !== "SHIP") {
    throw new ApiError("Labels only apply to SHIP packages", 409);
  }

  const idempotencyKey = labelBuyIdempotencyKey(pkg.id);
  const existing = await db.shippingLabel.findFirst({
    where: { packageId: pkg.id, status: ShippingLabelStatus.PURCHASED },
  });
  if (existing) {
    throw new ApiError("Package already has an active shipping label", 409);
  }

  const address = toAddress(pkg);
  const validation = await validateAddress(address);
  if (!validation.isValid) {
    throw new ApiError(
      `Address invalid: ${validation.messages.join("; ") || "validation failed"}`,
      400,
    );
  }
  const shipTo = validation.normalized ?? address;

  // Plan only — persist shipmentPlan after successful purchase (M2).
  const { plan } = await computePackageShipmentPlan(pkg.id);
  const fallbackWeight = Math.max(
    1,
    pkg.items.reduce(
      (sum, item) => sum + (item.orderLine.product.weightOz ?? 16) * item.quantity,
      0,
    ),
  );
  const parcels = planToParcels(plan, {
    lengthIn: 12,
    widthIn: 9,
    heightIn: 6,
    weightOz: fallbackWeight,
  });

  let margin: Awaited<ReturnType<typeof quoteMargin>>;
  try {
    margin = await quoteMargin({ addressTo: shipTo, parcels });
  } catch (error) {
    await recordFailedLabel({
      packageId: pkg.id,
      orderId: pkg.orderId,
      reason: error instanceof Error ? error.message : "rate quote failed",
      actorId: input.actorId,
    });
    throw new ApiError("Could not get shipping rates for this package", 502);
  }

  const txn = await buyLabel(margin.buyRate.objectId, idempotencyKey);
  if (txn.status !== "SUCCESS") {
    await recordFailedLabel({
      packageId: pkg.id,
      orderId: pkg.orderId,
      reason: txn.messages.join("; ") || "label purchase failed",
      actorId: input.actorId,
      quotesJson: margin,
      chargedCents: margin.chargedCents,
      purchasedCents: margin.purchasedCents,
    });
    throw new ApiError("Label purchase failed", 502);
  }

  const purchasedCents = txn.amountCents > 0 ? txn.amountCents : margin.purchasedCents;
  const carrier = txn.carrier || margin.buyRate.carrier;
  const serviceLevel = txn.serviceLevel || margin.buyRate.serviceLevel;
  const marginCents = margin.chargedCents - purchasedCents;
  const storedMargin = { ...margin, purchasedCents, marginCents };

  try {
    const label = await db.$transaction(async (tx) => {
      await tx.package.update({
        where: { id: pkg.id },
        data: { shipmentPlan: plan },
      });
      const created = await tx.shippingLabel.create({
        data: {
          packageId: pkg.id,
          orderId: pkg.orderId,
          status: ShippingLabelStatus.PURCHASED,
          carrier,
          serviceLevel,
          shippoRateId: margin.buyRate.objectId,
          shippoTransactionId: txn.objectId,
          trackingNumber: txn.trackingNumber,
          labelUrl: txn.labelUrl,
          chargedCents: margin.chargedCents,
          purchasedCents,
          marginCents,
          quotesJson: storedMargin as unknown as Prisma.InputJsonValue,
          idempotencyKey,
        },
      });
      await writeAudit(
        {
          action: AuditAction.LABEL_PURCHASED,
          actorId: input.actorId,
          meta: labelAuditMeta(created),
        },
        tx,
      );
      return created;
    });
    return { label, margin: storedMargin, plan };
  } catch (error) {
    const raced = await db.shippingLabel.findFirst({
      where: {
        OR: [{ idempotencyKey }, { packageId: pkg.id, status: ShippingLabelStatus.PURCHASED }],
      },
    });
    if (raced?.status === ShippingLabelStatus.PURCHASED) {
      return { label: raced, margin: storedMargin, plan };
    }
    throw error;
  }
}

async function recordFailedLabel(input: {
  packageId: string;
  orderId: string;
  reason: string;
  actorId?: string | null;
  quotesJson?: unknown;
  chargedCents?: number;
  purchasedCents?: number;
}) {
  const charged = input.chargedCents ?? 0;
  const purchased = input.purchasedCents ?? 0;
  await db.$transaction(async (tx) => {
    const failed = await tx.shippingLabel.create({
      data: {
        packageId: input.packageId,
        orderId: input.orderId,
        status: ShippingLabelStatus.FAILED,
        carrier: "none",
        serviceLevel: "none",
        chargedCents: charged,
        purchasedCents: purchased,
        marginCents: charged - purchased,
        quotesJson: (input.quotesJson ?? {}) as Prisma.InputJsonValue,
        failureReason: input.reason,
      },
    });
    await writeAudit(
      {
        action: AuditAction.LABEL_FAILED,
        actorId: input.actorId,
        meta: labelAuditMeta(failed, { reason: input.reason }),
      },
      tx,
    );
  });
}

export async function voidLabelForPackage(input: {
  packageId: string;
  actorId?: string | null;
  seasonId?: string;
  /** When set, DB void runs on this client (caller owns the transaction). Shippo still runs first. */
  tx?: Prisma.TransactionClient;
}): Promise<{ labelId: string }> {
  const label = await db.shippingLabel.findFirst({
    where: {
      packageId: input.packageId,
      status: ShippingLabelStatus.PURCHASED,
      ...(input.seasonId ? { order: { seasonId: input.seasonId } } : {}),
    },
    include: { package: true },
  });
  if (!label) throw new ApiError("No active label to void", 404);
  if (!isVoidable(label)) {
    throw new ApiError("Label is assigned to a route and cannot be voided here (P9)", 409);
  }
  if (label.package.stage === PackageStage.SENT || label.package.stage === PackageStage.PICKED_UP) {
    throw new ApiError("Cannot void a label after package is marked sent", 409);
  }

  if (label.shippoTransactionId) {
    const result = await voidLabel(label.shippoTransactionId);
    if (!result.ok) {
      throw new ApiError("Shippo void failed", 502);
    }
  }

  const persist = async (client: Prisma.TransactionClient | typeof db) => {
    await client.shippingLabel.update({
      where: { id: label.id },
      // Clear key so a later re-purchase can reuse label-buy:{packageId}.
      data: { status: ShippingLabelStatus.VOIDED, voidedAt: new Date(), idempotencyKey: null },
    });
    await writeAudit(
      {
        action: AuditAction.LABEL_VOIDED,
        actorId: input.actorId,
        meta: labelAuditMeta(label),
      },
      client,
    );
  };

  if (input.tx) {
    await persist(input.tx);
  } else {
    await db.$transaction(async (tx) => persist(tx));
  }

  return { labelId: label.id };
}

export async function refreshTracking(
  labelId: string,
  actorId?: string | null,
  seasonId?: string,
) {
  const label = await db.shippingLabel.findFirst({
    where: {
      id: labelId,
      ...(seasonId ? { order: { seasonId } } : {}),
    },
  });
  if (!label?.trackingNumber) throw new ApiError("Label has no tracking number", 404);
  const tracking = await trackShipment(label.carrier, label.trackingNumber);
  return db.$transaction(async (tx) => {
    const updated = await tx.shippingLabel.update({
      where: { id: label.id },
      data: {
        trackingStatus: tracking.status,
        trackingUpdatedAt: new Date(tracking.updatedAt),
      },
    });
    await writeAudit(
      {
        action: AuditAction.TRACKING_REFRESHED,
        actorId,
        meta: labelAuditMeta(label, { status: tracking.status }),
      },
      tx,
    );
    return updated;
  });
}

/** P9 hook stub — marks label non-voidable once on a route. */
export async function stubAssignLabelToRoute(labelId: string) {
  return db.shippingLabel.update({
    where: { id: labelId },
    data: { routeAssignedAt: new Date() },
  });
}
