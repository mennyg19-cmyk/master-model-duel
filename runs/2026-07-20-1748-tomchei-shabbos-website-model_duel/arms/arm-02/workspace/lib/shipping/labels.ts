import type { PackageStage } from "@prisma/client";
import { db } from "@/lib/db";
import { ActionError } from "@/lib/packages/actions";
import type { PackItem } from "@/lib/shipping/bin-packing";
import { quoteShipping } from "@/lib/shipping/quotes";
import { buyLabel, trackShipment, validateAddress, voidLabel } from "@/lib/shipping/shippo";

// Label lifecycle for a Package (R-055): buy from the margin engine's decision,
// void while the box hasn't shipped, refresh carrier tracking (R-176).
// Purchasing never advances the package stage — printing/packing/sending stay
// staff acts (G-002).

/**
 * A label is voidable until the box physically leaves: any pre-terminal stage
 * (including PRINTED — S3). This is also the P9 reroute hook: map reroute must
 * call voidShipmentForPackage before pulling a shipping package onto a route.
 */
export function canVoidShipment(stage: PackageStage): boolean {
  return stage !== "SENT" && stage !== "PICKED_UP";
}

async function loadShippingPackage(seasonId: string, packageId: string) {
  const pkg = await db.package.findFirst({
    where: { id: packageId, seasonId },
    include: {
      fulfillmentMethod: { select: { kind: true } },
      lines: { include: { product: { select: { name: true, lengthCm: true, widthCm: true, heightCm: true, weightGrams: true } } } },
      shipments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!pkg) throw new ActionError("Package not found", 404);
  if (pkg.fulfillmentMethod.kind !== "SHIPPING") {
    throw new ActionError("Labels only apply to shipping packages", 400);
  }
  return pkg;
}

function packItems(pkg: Awaited<ReturnType<typeof loadShippingPackage>>): PackItem[] {
  return pkg.lines.map((line) => ({
    name: line.product.name,
    quantity: line.quantity,
    lengthCm: line.product.lengthCm,
    widthCm: line.product.widthCm,
    heightCm: line.product.heightCm,
    weightGrams: line.product.weightGrams,
  }));
}

/**
 * Buy a label for a shipping package. Address is Shippo-validated first
 * (R-177). A carrier refusal is compensated (R-175): the package, its stage,
 * and the customer's money are untouched; a visible FAILED Shipment row keeps
 * the trace and the purchase can simply be retried.
 */
export async function buyLabelForPackage(seasonId: string, packageId: string, staffId?: string) {
  const pkg = await loadShippingPackage(seasonId, packageId);
  if (!canVoidShipment(pkg.stage)) {
    throw new ActionError("This package already shipped — no new label can be bought");
  }
  if (pkg.lines.length === 0) throw new ActionError("An empty package cannot ship", 400);
  if (pkg.shipments.some((shipment) => shipment.status === "PURCHASED")) {
    throw new ActionError("This package already has an active label — void it before buying another");
  }

  const to = {
    name: pkg.recipientName,
    line1: pkg.addressLine1,
    line2: pkg.addressLine2,
    city: pkg.city,
    state: pkg.state,
    zip: pkg.zip,
  };
  const check = await validateAddress(to);
  if (!check.valid) {
    throw new ActionError(`The carrier rejected this address: ${check.messages.join("; ") || "unknown reason"}`);
  }

  const quoted = await quoteShipping(to, packItems(pkg), { packageId: pkg.id });
  if ("error" in quoted) throw new ActionError(quoted.error);
  const { decision, parcels } = quoted;

  const shipmentBase = {
    packageId: pkg.id,
    carrier: decision.buy.carrier,
    service: decision.buy.service,
    shippoRateId: decision.buy.rateId,
    costCents: decision.buy.amountCents,
    chargedCents: decision.chargeCents,
    marginCents: decision.marginCents,
    quotedRates: decision.perCarrierBest.map((rate) => ({
      carrier: rate.carrier,
      service: rate.service,
      amountCents: rate.amountCents,
    })),
    parcels: parcels.map((parcel) => ({ ...parcel })),
    createdByStaffId: staffId,
  };

  let label;
  try {
    label = await buyLabel(decision.buy.rateId);
  } catch (error) {
    // Compensation (R-175): nothing was charged and no state moved; record the
    // refusal where staff can see it and surface a retryable message.
    const reason = (error as Error).message.slice(0, 500);
    await db.$transaction(async (tx) => {
      const failed = await tx.shipment.create({
        data: { ...shipmentBase, status: "FAILED", failureReason: reason },
      });
      await tx.packageAudit.create({
        data: { packageId: pkg.id, actorStaffId: staffId, action: "label_failed", detail: { shipmentId: failed.id, reason } },
      });
    });
    throw new ActionError(`The carrier refused the label — nothing was charged. ${reason}`);
  }

  return db.$transaction(async (tx) => {
    const shipment = await tx.shipment.create({
      data: {
        ...shipmentBase,
        status: "PURCHASED",
        shippoTransactionId: label.transactionId,
        labelUrl: label.labelUrl,
        trackingNumber: label.trackingNumber,
      },
    });
    await tx.packageAudit.create({
      data: {
        packageId: pkg.id,
        actorStaffId: staffId,
        action: "label_purchased",
        detail: {
          shipmentId: shipment.id,
          carrier: shipment.carrier,
          costCents: shipment.costCents,
          chargedCents: shipment.chargedCents,
          marginCents: shipment.marginCents,
        },
      },
    });
    return shipment;
  });
}

/** Void an active label. Refused once the box shipped (S3 guard / P9 reroute hook). */
export async function voidShipmentById(seasonId: string, shipmentId: string, staffId?: string) {
  const shipment = await db.shipment.findFirst({
    where: { id: shipmentId, package: { seasonId } },
    include: { package: { select: { id: true, stage: true } } },
  });
  if (!shipment) throw new ActionError("Shipment not found", 404);
  if (shipment.status !== "PURCHASED") throw new ActionError("Only an active label can be voided");
  if (!canVoidShipment(shipment.package.stage)) {
    throw new ActionError("This package already shipped — its label can no longer be voided");
  }

  if (shipment.shippoTransactionId) await voidLabel(shipment.shippoTransactionId);

  return db.$transaction(async (tx) => {
    const voided = await tx.shipment.update({
      where: { id: shipment.id },
      data: { status: "VOIDED", voidedAt: new Date(), voidedByStaffId: staffId },
    });
    await tx.packageAudit.create({
      data: {
        packageId: shipment.package.id,
        actorStaffId: staffId,
        action: "label_voided",
        detail: { shipmentId: shipment.id, carrier: shipment.carrier, costCents: shipment.costCents },
      },
    });
    return voided;
  });
}

/** Pull the latest carrier tracking status onto the shipment (R-176). */
export async function refreshShipmentTracking(seasonId: string, shipmentId: string) {
  const shipment = await db.shipment.findFirst({
    where: { id: shipmentId, package: { seasonId } },
  });
  if (!shipment) throw new ActionError("Shipment not found", 404);
  if (shipment.status !== "PURCHASED" || !shipment.trackingNumber) {
    throw new ActionError("Only an active label has tracking to refresh");
  }

  const status = await trackShipment(shipment.carrier, shipment.trackingNumber);
  return db.shipment.update({
    where: { id: shipment.id },
    data: { trackingStatus: status, trackingUpdatedAt: new Date() },
  });
}
