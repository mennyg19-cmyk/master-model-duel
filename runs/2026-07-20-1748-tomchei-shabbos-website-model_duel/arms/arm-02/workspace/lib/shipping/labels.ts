import type { PackageStage, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { destinationKey } from "@/lib/checkout/recipients";
import { ActionError } from "@/lib/packages/actions";
import type { PackItem } from "@/lib/shipping/bin-packing";
import { quoteShipping } from "@/lib/shipping/quotes";
import { buyLabel, trackShipment, validateAddress, voidLabel, type PurchasedLabel } from "@/lib/shipping/shippo";

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

type PaidShippingAnchor = { chargedCents: number; quoteId: string | null };

/**
 * What the customer actually paid to ship to this package's destination (M4):
 * the shipping fee line frozen onto the order at checkout, carrying the
 * ShippingQuote it came from. Staff-built packages (or pre-fix orders) have no
 * such line — the caller falls back to the label-time quote and says so.
 */
async function findPaidShippingAnchor(
  pkg: Awaited<ReturnType<typeof loadShippingPackage>>
): Promise<PaidShippingAnchor | null> {
  const orderIds = [...new Set(pkg.lines.map((line) => line.orderId))];
  if (orderIds.length === 0) return null;
  const destination = destinationKey({
    line1: pkg.addressLine1,
    line2: pkg.addressLine2,
    city: pkg.city,
    state: pkg.state,
    zip: pkg.zip,
  });
  const orders = await db.order.findMany({
    where: { id: { in: orderIds } },
    select: { feeBreakdown: true },
  });
  for (const order of orders) {
    if (!Array.isArray(order.feeBreakdown)) continue;
    for (const entry of order.feeBreakdown as { destination?: string; amountCents?: number; quoteId?: string }[]) {
      if (entry?.destination === destination && typeof entry.amountCents === "number") {
        return { chargedCents: entry.amountCents, quoteId: entry.quoteId ?? null };
      }
    }
  }
  return null;
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

  // M4: the recorded charge is what the customer PAID at checkout for this
  // destination, not a rate that may have moved since. The label-time quote
  // still decides which rate to buy (its rateId must be fresh); only the
  // charge/margin bookkeeping anchors back. Staff-built packages with no
  // checkout shipping fee fall back to the label-time charge.
  const anchor = await findPaidShippingAnchor(pkg);
  const chargedCents = anchor?.chargedCents ?? decision.chargeCents;

  const shipmentBase = {
    packageId: pkg.id,
    // M6: FK to the quote the charge is anchored to (checkout quote when
    // matched, else the label-time comparison quote persisted above).
    quoteId: anchor?.quoteId ?? quoted.quoteId,
    carrier: decision.buy.carrier,
    service: decision.buy.service,
    shippoRateId: decision.buy.rateId,
    costCents: decision.buy.amountCents,
    chargedCents,
    marginCents: chargedCents - decision.buy.amountCents,
    quotedRates: decision.perCarrierBest.map((rate) => ({
      carrier: rate.carrier,
      service: rate.service,
      amountCents: rate.amountCents,
    })),
    parcels: parcels.map((parcel) => ({ ...parcel })),
    createdByStaffId: staffId,
  };

  // M2: serialize concurrent buys for one package. The advisory xact lock
  // (same pattern as finalize.ts) makes the second POST wait, re-check, and
  // refuse BEFORE it reaches Shippo — no double charge. The partial unique
  // index Shipment_packageId_purchased_key backstops the invariant at the DB
  // layer. The Shippo call is bounded by SHIPPO_TIMEOUT_MS, so the held
  // transaction cannot hang open.
  let label: PurchasedLabel | undefined;
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`package-label|${pkg.id}`}, 0))::text`;
        const active = await tx.shipment.findFirst({
          where: { packageId: pkg.id, status: "PURCHASED" },
          select: { id: true },
        });
        if (active) {
          throw new ActionError("This package already has an active label — void it before buying another");
        }

        label = await buyLabel(decision.buy.rateId);
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
      },
      { maxWait: 10_000, timeout: 45_000 }
    );
  } catch (error) {
    if (error instanceof ActionError) throw error;

    if (label !== undefined) {
      // The carrier charged us but the DB write failed (M2): refund the label
      // so no money is spent without a record, then leave a visible trace.
      await voidLabel(label.transactionId).catch(() => undefined);
      const reason = `Label ${label.transactionId} was bought but could not be recorded — a void/refund was requested. ${(error as Error).message}`.slice(0, 500);
      await recordFailedShipment(shipmentBase, pkg.id, staffId, reason);
      throw new ActionError(`Something went wrong recording the label — the purchase was refunded. Try again.`);
    }

    // Compensation (R-175): nothing was charged and no state moved; record the
    // refusal where staff can see it and surface a retryable message.
    const reason = (error as Error).message.slice(0, 500);
    await recordFailedShipment(shipmentBase, pkg.id, staffId, reason);
    throw new ActionError(`The carrier refused the label — nothing was charged. ${reason}`);
  }
}

async function recordFailedShipment(
  shipmentBase: Omit<Prisma.ShipmentUncheckedCreateInput, "status">,
  packageId: string,
  staffId: string | undefined,
  reason: string
) {
  await db.$transaction(async (tx) => {
    const failed = await tx.shipment.create({
      data: { ...shipmentBase, status: "FAILED", failureReason: reason },
    });
    await tx.packageAudit.create({
      data: { packageId, actorStaffId: staffId, action: "label_failed", detail: { shipmentId: failed.id, reason } },
    });
  });
}

/**
 * Void an active label. Refused once the box shipped (S3 guard / P9 reroute hook).
 *
 * Ordering (M1): the DB flips to VOIDED FIRST — a guarded update that only one
 * concurrent void can win — and the carrier refund runs after. The dangerous
 * inconsistency (carrier refunded while the row still says PURCHASED, inviting
 * a re-void / double refund) can no longer occur; if the carrier refuses the
 * refund, the flip is rolled back with an audit trace and the retry is clean.
 */
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

  const voided = await db.$transaction(async (tx) => {
    // Guarded flip: a concurrent void (or a just-completed one) finds 0 rows
    // and refuses instead of double-refunding — idempotent under retry.
    const flipped = await tx.shipment.updateMany({
      where: { id: shipment.id, status: "PURCHASED" },
      data: { status: "VOIDED", voidedAt: new Date(), voidedByStaffId: staffId },
    });
    if (flipped.count === 0) throw new ActionError("Only an active label can be voided");
    await tx.packageAudit.create({
      data: {
        packageId: shipment.package.id,
        actorStaffId: staffId,
        action: "label_voided",
        detail: { shipmentId: shipment.id, carrier: shipment.carrier, costCents: shipment.costCents },
      },
    });
    return tx.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
  });

  if (shipment.shippoTransactionId) {
    try {
      await voidLabel(shipment.shippoTransactionId);
    } catch (error) {
      // Carrier refused the refund: roll the flip back so the label stays
      // active and staff can retry — and say so instead of an opaque 500 (B2).
      const reason = (error as Error).message.slice(0, 500);
      await db.$transaction(async (tx) => {
        await tx.shipment.update({
          where: { id: shipment.id },
          data: { status: "PURCHASED", voidedAt: null, voidedByStaffId: null },
        });
        await tx.packageAudit.create({
          data: {
            packageId: shipment.package.id,
            actorStaffId: staffId,
            action: "label_void_failed",
            detail: { shipmentId: shipment.id, reason },
          },
        });
      });
      throw new ActionError(`The carrier refused the void — the label is still active. ${reason}`, 502);
    }
  }

  return voided;
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

  let status: string;
  try {
    status = await trackShipment(shipment.carrier, shipment.trackingNumber);
  } catch (error) {
    // B2: a tracking hiccup is a human message, not an opaque 500.
    throw new ActionError(
      `Tracking is unavailable right now — nothing changed. ${(error as Error).message.slice(0, 300)}`,
      502
    );
  }
  return db.shipment.update({
    where: { id: shipment.id },
    data: { trackingStatus: status, trackingUpdatedAt: new Date() },
  });
}
