import { Prisma, Shipment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { PackageEventAction } from "@/lib/packages/stages";
import { planParcelsForPackage, quoteShipping } from "@/lib/shipping/quotes";
import {
  buyLabelTransaction,
  getTracking,
  validateAddress,
  voidLabelTransaction,
} from "@/lib/shipping/shippo";

// R-055/R-175/R-176/R-177: carrier label lifecycle for SHIPPED packages.
// Money law (UR-003): the customer charge is the frozen checkout snapshot,
// the label cost is what Shippo bills, and margin = charge − cost lands on
// the Shipment row the moment a label succeeds. A failed label never mutates
// the paid order (R-175) — the row records the failure and staff retry.

export class LabelPurchaseError extends Error {
  constructor(detail: string) {
    super(`Label purchase failed: ${detail}`);
    this.name = "LabelPurchaseError";
  }
}

export class LabelVoidError extends Error {
  constructor(detail: string) {
    super(`Label void failed: ${detail}`);
    this.name = "LabelVoidError";
  }
}

async function loadShippedPackage(packageId: string) {
  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    include: {
      fulfillmentMethod: true,
      recipientAddress: true,
      order: {
        select: {
          id: true,
          seasonId: true,
          season: { select: { status: true } },
          recipients: { select: { id: true, deliveryFeeCents: true, fulfillmentChoice: true } },
        },
      },
      lines: {
        select: {
          orderLine: {
            select: {
              recipientId: true,
              recipient: {
                select: { line1: true, line2: true, city: true, region: true, postalCode: true, country: true },
              },
            },
          },
        },
      },
      shipments: { where: { status: { in: ["PURCHASING", "PURCHASED"] } } },
    },
  });
  if (!pkg) throw new NotFoundError("Package", packageId);
  if (pkg.order.season.status !== "OPEN") {
    throw new NotFoundError("Package in the open season", packageId);
  }
  if (pkg.channel !== "SHIPPED") {
    throw new DomainRuleError(`Package ${packageId} ships via ${pkg.channel}; expected SHIPPED to buy a carrier label`);
  }
  if (pkg.stage === pkg.fulfillmentMethod.terminalStage) {
    throw new DomainRuleError(`Package ${packageId} is ${pkg.stage} — the carrier has it; labels can't change now`);
  }
  return pkg;
}

type ShippedPackage = Awaited<ReturnType<typeof loadShippedPackage>>;

// Label destination: the book address when the recipient linked one, else the
// draft recipient's inline snapshot (guests never touch the address book, but
// the snapshot is non-null by construction). A merged SHIPPED package groups
// by that same snapshot, so any member's copy is the package's address.
function destinationFor(pkg: ShippedPackage) {
  const source = pkg.recipientAddress ?? pkg.lines[0]?.orderLine.recipient ?? null;
  if (!source) {
    throw new DomainRuleError(`Package ${pkg.id} has no recipient address; expected one to buy a label`);
  }
  return {
    name: pkg.recipientName,
    line1: source.line1,
    line2: source.line2,
    city: source.city,
    region: source.region,
    postalCode: source.postalCode,
    country: source.country,
  };
}

// The package's paid shipping charge: sum of its member recipients' frozen
// fee snapshots (a merged SHIPPED package carries each member's fee).
function chargedCentsFor(pkg: ShippedPackage): number {
  const memberRecipientIds = new Set(
    pkg.lines.map((line) => line.orderLine.recipientId).filter((id): id is string => id !== null),
  );
  return pkg.order.recipients
    .filter((recipient) => memberRecipientIds.has(recipient.id))
    .reduce((sum, recipient) => sum + recipient.deliveryFeeCents, 0);
}

async function writeEvent(
  tx: Prisma.TransactionClient | typeof prisma,
  packageId: string,
  action: PackageEventAction,
  actorId: string,
  metadata: Prisma.InputJsonValue,
) {
  await tx.packageEvent.create({ data: { packageId, action, actorId, metadata } });
}

export async function buyLabel(input: { packageId: string; ctx: AuditContextLike }): Promise<Shipment> {
  const pkg = await loadShippedPackage(input.packageId);
  if (pkg.shipments.length > 0) {
    throw new DomainRuleError(`Package ${input.packageId} already has an active label — void it before buying again`);
  }
  const destination = destinationFor(pkg);
  const actorId = input.ctx.staff.id;

  // R-177: validate before any money moves; an undeliverable address fails
  // the attempt, not the carrier.
  const validation = await validateAddress(destination);
  if (!validation.isValid) {
    await writeEvent(prisma, pkg.id, "address_validate", actorId, {
      isValid: false,
      messages: validation.messages,
    });
    throw new DomainRuleError(
      `Address failed carrier validation: ${validation.messages.join("; ") || "no detail from the carrier"}`,
    );
  }

  const parcels = await planParcelsForPackage(prisma, pkg.id);
  const quote = await quoteShipping({ parcels, destination, scope: { packageId: pkg.id } });
  const chargedCents = chargedCentsFor(pkg);

  let shipment: Shipment;
  try {
    shipment = await prisma.shipment.create({
      data: {
        packageId: pkg.id,
        status: "PURCHASING",
        rateId: quote.margin.buy.rateId,
        carrier: quote.margin.buy.carrier,
        serviceLevel: quote.margin.buy.serviceLevel,
        chargedCents,
        parcels: parcels as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    // Two staff clicking buy at once: the partial unique index (one active
    // shipment per package) decides — the loser gets the same rule message a
    // serial attempt would have gotten (R-072).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DomainRuleError(`Package ${input.packageId} already has an active label — void it before buying again`);
    }
    throw error;
  }

  try {
    const transaction = await buyLabelTransaction(quote.margin.buy.rateId);
    if (transaction.status !== "SUCCESS") {
      const detail =
        transaction.messages.map((message) => message.text).filter(Boolean).join("; ") ||
        "carrier rejected the transaction";
      throw new LabelPurchaseError(detail);
    }
    const costCents = Math.round(Number(transaction.rate?.amount ?? "0") * 100);
    const marginCents = chargedCents - costCents;
    return await prisma.$transaction(async (tx) => {
      const row = await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status: "PURCHASED",
          shippoTransactionId: transaction.object_id,
          trackingNumber: transaction.tracking_number ?? null,
          labelUrl: transaction.label_url ?? null,
          costCents,
          marginCents,
        },
      });
      await writeEvent(tx, pkg.id, "label_buy", actorId, {
        shipmentId: row.id,
        carrier: quote.margin.buy.carrier,
        serviceLevel: quote.margin.buy.serviceLevel,
        trackingNumber: row.trackingNumber,
        chargedCents,
        costCents,
        marginCents,
      });
      await recordAudit(
        {
          ctx: input.ctx,
          action: "label_buy",
          targetType: "Package",
          targetId: pkg.id,
          metadata: { shipmentId: row.id, carrier: quote.margin.buy.carrier, chargedCents, costCents, marginCents },
        },
        tx,
      );
      return row;
    });
  } catch (error) {
    // R-175 compensation: the failed attempt is recorded with the carrier's
    // reason and the package stays label-less; the paid order total is never
    // touched by a label failure. Staff fix the cause and retry.
    const detail = error instanceof Error ? error.message : String(error);
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "FAILED", error: detail } });
    await writeEvent(prisma, pkg.id, "label_failed", actorId, { shipmentId: shipment.id, error: detail });
    if (error instanceof LabelPurchaseError) throw error;
    throw new LabelPurchaseError(detail);
  }
}

export async function voidLabel(input: {
  packageId: string;
  ctx: AuditContextLike;
  reason?: string;
}): Promise<Shipment> {
  const pkg = await loadShippedPackage(input.packageId);
  const actorId = input.ctx.staff.id;
  const active = pkg.shipments.find((shipment) => shipment.status === "PURCHASED");
  if (!active) {
    throw new DomainRuleError(`Package ${input.packageId} has no purchased label to void`);
  }
  if (!active.shippoTransactionId) {
    throw new LabelVoidError("the purchased label is missing its carrier transaction id");
  }

  const refund = await voidLabelTransaction(active.shippoTransactionId);
  if (refund.status === "ERROR") {
    const detail =
      refund.messages.map((message) => message.text).filter(Boolean).join("; ") || "carrier rejected the void";
    throw new LabelVoidError(detail);
  }
  // SUCCESS or QUEUED/PENDING: Shippo processes voids asynchronously — the
  // label is dead to us either way, and the refund settles carrier-side.
  return prisma.$transaction(async (tx) => {
    const row = await tx.shipment.update({
      where: { id: active.id },
      data: { status: "VOIDED", voidedAt: new Date() },
    });
    await writeEvent(tx, pkg.id, "label_void", actorId, {
      shipmentId: row.id,
      reason: input.reason ?? null,
      refundStatus: refund.status,
      reversedCostCents: active.costCents,
    });
    await recordAudit(
      {
        ctx: input.ctx,
        action: "label_void",
        targetType: "Package",
        targetId: pkg.id,
        metadata: { shipmentId: row.id, reason: input.reason ?? null, reversedCostCents: active.costCents },
      },
      tx,
    );
    return row;
  });
}

// UR-004 hook (P9): a manager-confirmed map reroute voids the printed-but-
// unshipped label through this exact path before the package joins a route.
export async function voidActiveShipmentForReroute(input: {
  packageId: string;
  ctx: AuditContextLike;
  reason: string;
}): Promise<Shipment> {
  return voidLabel(input);
}

export async function refreshTracking(input: { packageId: string; ctx: AuditContextLike }): Promise<Shipment> {
  const pkg = await loadShippedPackage(input.packageId);
  const active = pkg.shipments.find((shipment) => shipment.status === "PURCHASED");
  if (!active || !active.trackingNumber || !active.carrier) {
    throw new DomainRuleError(`Package ${input.packageId} has no purchased label with a tracking number`);
  }
  const track = await getTracking(active.carrier, active.trackingNumber);
  const statusDate = track.statusDate ? new Date(track.statusDate) : null;
  return prisma.$transaction(async (tx) => {
    const row = await tx.shipment.update({
      where: { id: active.id },
      data: {
        trackingStatus: track.status,
        trackingStatusAt: statusDate && !Number.isNaN(statusDate.getTime()) ? statusDate : new Date(),
      },
    });
    await writeEvent(tx, pkg.id, "tracking_refresh", input.ctx.staff.id, {
      shipmentId: row.id,
      trackingNumber: active.trackingNumber,
      status: track.status,
      statusDetails: track.statusDetails,
    });
    return row;
  });
}

// R-177 on demand: staff can check an address without buying anything.
export async function validatePackageAddress(input: { packageId: string; ctx: AuditContextLike }) {
  const pkg = await loadShippedPackage(input.packageId);
  const validation = await validateAddress(destinationFor(pkg));
  await writeEvent(prisma, pkg.id, "address_validate", input.ctx.staff.id, {
    isValid: validation.isValid,
    messages: validation.messages,
  });
  return validation;
}
