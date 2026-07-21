import {
  AuditAction,
  PackageStage,
  Prisma,
  ShippingLabelStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { buyLabel, trackShipment, validateAddress, voidLabel } from "@/lib/shippo/client";
import { quoteMargin } from "@/lib/shipping/margin";
import {
  planPackageShipment,
  planToParcel,
  type ShipmentPlan,
} from "@/lib/shipping/bin-packing";

export class LabelError extends Error {
  constructor(
    message: string,
    readonly status: number = 409,
  ) {
    super(message);
  }
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
}): Promise<{
  label: Awaited<ReturnType<typeof db.shippingLabel.create>>;
  margin: Awaited<ReturnType<typeof quoteMargin>>;
  plan: ShipmentPlan;
}> {
  const pkg = await db.package.findUnique({
    where: { id: input.packageId },
    include: {
      fulfillmentMethod: true,
      items: { include: { orderLine: { include: { product: true } } } },
    },
  });
  if (!pkg) throw new LabelError("Package not found", 404);
  if (pkg.fulfillmentMethod.code !== "SHIP") {
    throw new LabelError("Labels only apply to SHIP packages");
  }

  const existing = await db.shippingLabel.findFirst({
    where: { packageId: pkg.id, status: ShippingLabelStatus.PURCHASED },
  });
  if (existing) throw new LabelError("Package already has an active shipping label");

  const address = toAddress(pkg);
  const validation = await validateAddress(address);
  if (!validation.isValid) {
    throw new LabelError(`Address invalid: ${validation.messages.join("; ") || "failed"}`);
  }

  const plan = await planPackageShipment(pkg.id);
  const fallbackParcel = {
    lengthIn: 12,
    widthIn: 9,
    heightIn: 6,
    weightOz: Math.max(
      1,
      pkg.items.reduce(
        (sum, item) => sum + (item.orderLine.product.weightOz ?? 16) * item.quantity,
        0,
      ),
    ),
  };
  const parcel = planToParcel(plan, fallbackParcel);

  let margin: Awaited<ReturnType<typeof quoteMargin>>;
  try {
    margin = await quoteMargin({ addressTo: address, parcel });
  } catch (error) {
    await recordFailedLabel({
      packageId: pkg.id,
      orderId: pkg.orderId,
      reason: error instanceof Error ? error.message : "rate quote failed",
      actorId: input.actorId,
    });
    throw new LabelError(error instanceof Error ? error.message : "rate quote failed");
  }

  const txn = await buyLabel(margin.buyRate.objectId);
  if (txn.status !== "SUCCESS") {
    // R-175: compensate — no PURCHASED row; record FAILED + audit.
    await recordFailedLabel({
      packageId: pkg.id,
      orderId: pkg.orderId,
      reason: txn.messages.join("; ") || "label purchase failed",
      actorId: input.actorId,
      quotesJson: margin,
      chargedCents: margin.chargedCents,
      purchasedCents: margin.purchasedCents,
    });
    throw new LabelError(txn.messages.join("; ") || "Label purchase failed");
  }

  const label = await db.$transaction(async (tx) => {
    const created = await tx.shippingLabel.create({
      data: {
        packageId: pkg.id,
        orderId: pkg.orderId,
        status: ShippingLabelStatus.PURCHASED,
        carrier: margin.buyRate.carrier,
        serviceLevel: margin.buyRate.serviceLevel,
        shippoRateId: margin.buyRate.objectId,
        shippoTransactionId: txn.objectId,
        trackingNumber: txn.trackingNumber,
        labelUrl: txn.labelUrl,
        chargedCents: margin.chargedCents,
        purchasedCents: margin.purchasedCents,
        marginCents: margin.marginCents,
        quotesJson: margin as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: {
        action: AuditAction.LABEL_PURCHASED,
        actorId: input.actorId ?? undefined,
        targetId: created.id,
        meta: {
          packageId: pkg.id,
          orderId: pkg.orderId,
          carrier: created.carrier,
          chargedCents: created.chargedCents,
          purchasedCents: created.purchasedCents,
          marginCents: created.marginCents,
          trackingNumber: created.trackingNumber,
        },
      },
    });
    return created;
  });

  return { label, margin, plan };
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
    await tx.auditLog.create({
      data: {
        action: AuditAction.LABEL_FAILED,
        actorId: input.actorId ?? undefined,
        targetId: failed.id,
        meta: { packageId: input.packageId, reason: input.reason },
      },
    });
  });
}

export async function voidLabelForPackage(input: {
  packageId: string;
  actorId?: string | null;
}): Promise<{ labelId: string }> {
  const label = await db.shippingLabel.findFirst({
    where: { packageId: input.packageId, status: ShippingLabelStatus.PURCHASED },
    include: { package: true },
  });
  if (!label) throw new LabelError("No active label to void", 404);
  if (!isVoidable(label)) {
    throw new LabelError("Label is assigned to a route and cannot be voided here (P9)");
  }
  // Printed-but-unshipped (stage PRINTED/PACKED/NEW) remains voidable — S3.
  if (label.package.stage === PackageStage.SENT || label.package.stage === PackageStage.PICKED_UP) {
    throw new LabelError("Cannot void a label after package is marked sent");
  }

  if (label.shippoTransactionId) {
    const result = await voidLabel(label.shippoTransactionId);
    if (!result.ok) {
      throw new LabelError(result.messages.join("; ") || "Shippo void failed");
    }
  }

  await db.$transaction(async (tx) => {
    await tx.shippingLabel.update({
      where: { id: label.id },
      data: { status: ShippingLabelStatus.VOIDED, voidedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        action: AuditAction.LABEL_VOIDED,
        actorId: input.actorId ?? undefined,
        targetId: label.id,
        meta: { packageId: input.packageId, trackingNumber: label.trackingNumber },
      },
    });
  });

  return { labelId: label.id };
}

export async function refreshTracking(labelId: string, actorId?: string | null) {
  const label = await db.shippingLabel.findUnique({ where: { id: labelId } });
  if (!label?.trackingNumber) throw new LabelError("Label has no tracking number", 404);
  const tracking = await trackShipment(label.carrier, label.trackingNumber);
  const updated = await db.shippingLabel.update({
    where: { id: label.id },
    data: {
      trackingStatus: tracking.status,
      trackingUpdatedAt: new Date(tracking.updatedAt),
    },
  });
  await db.auditLog.create({
    data: {
      action: AuditAction.TRACKING_REFRESHED,
      actorId: actorId ?? undefined,
      targetId: label.id,
      meta: { status: tracking.status },
    },
  });
  return updated;
}

/** P9 hook stub — marks label non-voidable once on a route. */
export async function stubAssignLabelToRoute(labelId: string) {
  return db.shippingLabel.update({
    where: { id: labelId },
    data: { routeAssignedAt: new Date() },
  });
}
