import { Prisma, Shipment, ShipmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { PackageEventAction } from "@/lib/packages/stages";
import { planParcelsForPackage, quoteShipping } from "@/lib/shipping/quotes";
import {
  buyLabelTransaction,
  getRefund,
  getTracking,
  ShippoNotConfiguredError,
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

// The in-flight-or-live shipment set, mirroring the partial unique index
// (shipments_one_active_per_package). VOIDED/FAILED are history.
export const ACTIVE_SHIPMENT_STATUSES: readonly ShipmentStatus[] = ["PURCHASING", "PURCHASED"];

// A PURCHASING row older than this never got its carrier confirmation
// recorded (crash, cold start, fetch timeout) — the shipping sweep resolves
// it and staff can force-resolve it sooner.
export const STUCK_PURCHASE_TTL_MINUTES = 15;

async function loadShippedPackage(packageId: string, options?: { allowTerminal?: boolean }) {
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
      shipments: { where: { status: { in: [...ACTIVE_SHIPMENT_STATUSES] } } },
    },
  });
  if (!pkg) throw new NotFoundError("Package", packageId);
  // M6: a closed season is a domain rule (409), not a missing resource —
  // staff seeing 404 here concluded the package didn't exist at all.
  if (pkg.order.season.status !== "OPEN") {
    throw new DomainRuleError(
      `Package ${packageId} belongs to a closed season; expected an open season for label operations`,
    );
  }
  if (pkg.channel !== "SHIPPED") {
    throw new DomainRuleError(`Package ${pkg.id} ships via ${pkg.channel}; expected SHIPPED to buy a carrier label`);
  }
  // Terminal guard by operation: buy/void/validate are refused once the
  // carrier has the package, but tracking refresh (R-176) is the live
  // operation AT the terminal stage — it must keep working there.
  if (!options?.allowTerminal && pkg.stage === pkg.fulfillmentMethod.terminalStage) {
    throw new DomainRuleError(`Package ${packageId} is ${pkg.stage} — the carrier has it; labels can't change now`);
  }
  return pkg;
}

type ShippedPackage = Awaited<ReturnType<typeof loadShippedPackage>>;

function pickPurchasedShipment(shipments: Shipment[]): Shipment | undefined {
  return shipments.find((shipment) => shipment.status === "PURCHASED");
}

function normalizedAddressKey(source: {
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}): string {
  return [source.line1, source.line2 ?? "", source.city, source.region, source.postalCode, source.country]
    .map((part) => part.trim().toLowerCase())
    .join("|");
}

// Label destination: the book address when the recipient linked one, else the
// draft recipient's inline snapshot (guests never touch the address book, but
// the snapshot is non-null by construction). A merged SHIPPED package groups
// by that same snapshot — the fallback still asserts every member agrees, so
// a future finer grouping key can never silently label one member's address
// onto the whole package.
function destinationFor(pkg: ShippedPackage) {
  if (!pkg.recipientAddress) {
    const members = pkg.lines
      .map((line) => line.orderLine.recipient)
      .filter((recipient): recipient is NonNullable<typeof recipient> => recipient !== null);
    const distinctKeys = new Set(members.map(normalizedAddressKey));
    if (distinctKeys.size > 1) {
      throw new DomainRuleError(
        `Package ${pkg.id} merges recipients with different addresses; expected one shared destination to buy a label`,
      );
    }
  }
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

// The package's paid shipping charge: each member recipient's frozen fee
// snapshot (a merged SHIPPED package carries each member's fee). The split is
// the ledger the P12 reconciliation reads to tell the honest per-recipient
// spread from the combined-parcel packing artifact.
function chargeBreakdownFor(pkg: ShippedPackage): { recipientId: string; chargedCents: number }[] {
  const memberRecipientIds = new Set(
    pkg.lines.map((line) => line.orderLine.recipientId).filter((id): id is string => id !== null),
  );
  return pkg.order.recipients
    .filter((recipient) => memberRecipientIds.has(recipient.id))
    .map((recipient) => ({ recipientId: recipient.id, chargedCents: recipient.deliveryFeeCents }));
}

async function writeEvent(
  tx: Prisma.TransactionClient | typeof prisma,
  packageId: string,
  action: PackageEventAction,
  actorId: string | null,
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
  // m13: ShippingQuote rows are the R-155 CHECKOUT rate-lock record — the
  // label buy prices fresh and persists its own Shipment ledger fields, so it
  // must not mix package-scoped rows into the rate-lock table.
  const quote = await quoteShipping({ parcels, destination, scope: { packageId: pkg.id }, persist: false });
  const chargeBreakdown = chargeBreakdownFor(pkg);
  const chargedCents = chargeBreakdown.reduce((sum, member) => sum + member.chargedCents, 0);

  let shipment: Shipment;
  try {
    shipment = await prisma.shipment.create({
      data: {
        packageId: pkg.id,
        status: "PURCHASING",
        rateId: quote.margin.buy.rateId,
        carrier: quote.margin.buy.carrier,
        serviceLevel: quote.margin.buy.serviceLevel,
        shippoShipmentId: quote.shippoShipmentId,
        chargedCents,
        chargeBreakdown: chargeBreakdown as unknown as Prisma.InputJsonValue,
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

  // The carrier call: any failure here means no sale was confirmed, so the
  // row records the failed attempt (R-175) and the paid order is untouched.
  let transaction;
  try {
    transaction = await buyLabelTransaction(quote.margin.buy.rateId);
    if (transaction.status !== "SUCCESS") {
      const detail =
        transaction.messages.map((message) => message.text).filter(Boolean).join("; ") ||
        "carrier rejected the transaction";
      throw new LabelPurchaseError(detail);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "FAILED", error: detail } });
    await writeEvent(prisma, pkg.id, "label_failed", actorId, { shipmentId: shipment.id, error: detail });
    if (error instanceof LabelPurchaseError) throw error;
    throw new LabelPurchaseError(detail);
  }

  // The zod boundary already guarantees a numeric amount; the cross-check
  // flags any drift from the rate that was actually selected instead of
  // silently booking it as margin.
  const costCents = Math.round(Number(transaction.rate?.amount ?? "0") * 100);
  const marginCents = chargedCents - costCents;
  const quotedCostCents = quote.margin.buy.amountCents;
  const costDriftCents = costCents - quotedCostCents;

  try {
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
        quotedCostCents,
        costDriftCents,
        mergedMembers: chargeBreakdown.length,
        ...(chargeBreakdown.length > 1
          ? {
              marginNote:
                "merged package: charge sums per-recipient checkout quotes, cost prices the combined-parcel shipment",
            }
          : {}),
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
  } catch (persistError) {
    // The carrier DID sell the label — flipping to FAILED would misrepresent
    // a paid label as a failed attempt. Best-effort record the carrier
    // identifiers and leave the row PURCHASING: the shipping sweep (or staff
    // force-resolve) completes it from the transaction id.
    const detail = persistError instanceof Error ? persistError.message : String(persistError);
    await prisma.shipment
      .update({
        where: { id: shipment.id },
        data: {
          shippoTransactionId: transaction.object_id,
          trackingNumber: transaction.tracking_number ?? null,
          labelUrl: transaction.label_url ?? null,
          costCents,
          marginCents,
          error: `carrier sale ${transaction.object_id} succeeded but the local persist failed: ${detail}`,
        },
      })
      .catch(() => undefined);
    throw new LabelPurchaseError(
      `the carrier sold the label (transaction ${transaction.object_id}) but recording it failed — expected state: the shipping sweep or staff force-resolve completes the stuck purchase; do not retry blindly. Cause: ${detail}`,
    );
  }
}

export interface CarrierRefund {
  object_id: string;
  status: string;
}

// The irreversible carrier call, isolated so callers can commit every LOCAL
// write (void marking + method flip + audit) in one atomic transaction AFTER
// it. A PURCHASED row carrying a shippoRefundId means the carrier void
// already succeeded for it — never call the carrier twice; complete the local
// marking from the stored refund id instead.
export async function requestLabelVoid(shippoTransactionId: string): Promise<CarrierRefund> {
  const refund = await voidLabelTransaction(shippoTransactionId);
  if (refund.status === "ERROR") {
    const detail =
      refund.messages.map((message) => message.text).filter(Boolean).join("; ") || "carrier rejected the void";
    throw new LabelVoidError(detail);
  }
  return refund;
}

// Local half of the void, inside the caller's transaction: SUCCESS or
// QUEUED/PENDING (Shippo processes voids asynchronously). The refund object
// id + status stay on the row so the shipping sweep can re-check unsettled
// refunds — a carrier decline reverts the row to PURCHASED with a
// label_void_rejected event.
export async function markLabelVoidedTx(
  tx: Prisma.TransactionClient,
  input: {
    active: Shipment;
    refund: CarrierRefund;
    packageId: string;
    actorId: string | null;
    reason?: string;
    ctx?: AuditContextLike;
  },
): Promise<Shipment> {
  const row = await tx.shipment.update({
    where: { id: input.active.id },
    data: {
      status: "VOIDED",
      voidedAt: new Date(),
      shippoRefundId: input.refund.object_id || null,
      refundStatus: input.refund.status,
      // Clears a crash-resume marker when a retry is completing the void.
      error: null,
    },
  });
  await writeEvent(tx, input.packageId, "label_void", input.actorId, {
    shipmentId: row.id,
    reason: input.reason ?? null,
    refundStatus: input.refund.status,
    reversedCostCents: input.active.costCents,
  });
  if (input.ctx) {
    await recordAudit(
      {
        ctx: input.ctx,
        action: "label_void",
        targetType: "Package",
        targetId: input.packageId,
        metadata: { shipmentId: row.id, reason: input.reason ?? null, reversedCostCents: input.active.costCents },
      },
      tx,
    );
  }
  return row;
}

// Compensation for the crash window the carrier call can never join: the
// carrier void succeeded but the local void+flip transaction failed. Persist
// the refund id on the still-PURCHASED row (best-effort, buyLabel's
// persist-failure discipline) so a retry skips the carrier call and completes
// locally — and the shipping sweep can reconcile even without one.
export async function persistVoidRefundMarker(active: Shipment, refund: CarrierRefund, cause: string): Promise<void> {
  await prisma.shipment
    .update({
      where: { id: active.id },
      data: {
        shippoRefundId: refund.object_id || null,
        refundStatus: refund.status,
        error: `carrier void ${refund.object_id || "(no refund id)"} succeeded but the local persist failed: ${cause}`,
      },
    })
    .catch(() => undefined);
}

export function voidCrashMessage(refund: CarrierRefund, cause: string): string {
  return (
    `the carrier voided the label (refund ${refund.object_id || "unknown"}) but recording it failed — ` +
    `expected state: re-running the same action completes the void + flip locally WITHOUT a second carrier call ` +
    `(the stored refund id is the proof); the shipping sweep reconciles it too. Cause: ${cause}`
  );
}

// A stored refund id proves the carrier void succeeded ONLY while the refund
// stands. A carrier-DECLINED refund (ERROR — the sweep reverts the row to
// PURCHASED) means the label is live: any new void must call the carrier
// again, never resurrect the dead refund.
export function usableStoredRefund(active: Shipment): CarrierRefund | null {
  if (!active.shippoRefundId || active.refundStatus === "ERROR") return null;
  return { object_id: active.shippoRefundId, status: active.refundStatus ?? "SUCCESS" };
}

export async function voidLabel(input: {
  packageId: string;
  ctx: AuditContextLike;
  reason?: string;
}): Promise<Shipment> {
  const pkg = await loadShippedPackage(input.packageId);
  const actorId = input.ctx.staff.id;
  const active = pickPurchasedShipment(pkg.shipments);
  if (!active) {
    throw new DomainRuleError(`Package ${input.packageId} has no purchased label to void`);
  }
  const storedRefund = usableStoredRefund(active);
  if (!active.shippoTransactionId && !storedRefund) {
    throw new LabelVoidError("the purchased label is missing its carrier transaction id");
  }

  const refund: CarrierRefund = storedRefund ?? (await requestLabelVoid(active.shippoTransactionId!));
  try {
    return await prisma.$transaction(async (tx) => {
      return markLabelVoidedTx(tx, { active, refund, packageId: pkg.id, actorId, reason: input.reason, ctx: input.ctx });
    });
  } catch (persistError) {
    const detail = persistError instanceof Error ? persistError.message : String(persistError);
    await persistVoidRefundMarker(active, refund, detail);
    throw new LabelVoidError(voidCrashMessage(refund, detail));
  }
}

// A stuck PURCHASING row resolves to its honest end state: a row carrying a
// carrier transaction id means the label WAS sold (the persist failed after
// the sale) — complete the purchase; a row with none means the sale never
// confirmed — fail it so the package can buy again. actorId null = the sweep.
async function resolveStuckShipment(shipment: Shipment, actorId: string | null, note: string): Promise<Shipment> {
  if (shipment.shippoTransactionId) {
    return prisma.$transaction(async (tx) => {
      const row = await tx.shipment.update({
        where: { id: shipment.id },
        data: { status: "PURCHASED", error: null },
      });
      await writeEvent(tx, shipment.packageId, "label_buy", actorId, {
        shipmentId: row.id,
        recoveredFromStuckPurchase: true,
        shippoTransactionId: shipment.shippoTransactionId,
        note,
      });
      return row;
    });
  }
  return prisma.$transaction(async (tx) => {
    const row = await tx.shipment.update({
      where: { id: shipment.id },
      data: { status: "FAILED", error: `purchase never confirmed by the carrier (${note})` },
    });
    await writeEvent(tx, shipment.packageId, "label_failed", actorId, {
      shipmentId: row.id,
      stuckPurchase: true,
      note,
    });
    return row;
  });
}

// Staff escape hatch for a stuck PURCHASING row (gated by fulfillment.manage
// at the route): same resolution the sweep applies, on demand.
export async function forceResolveStuckPurchase(input: {
  packageId: string;
  ctx: AuditContextLike;
}): Promise<Shipment> {
  const pkg = await loadShippedPackage(input.packageId);
  const stuck = pkg.shipments.find((shipment) => shipment.status === "PURCHASING");
  if (!stuck) {
    throw new DomainRuleError(`Package ${input.packageId} has no stuck purchase to resolve`);
  }
  return resolveStuckShipment(stuck, input.ctx.staff.id, "staff force-resolve");
}

export interface ShippingSweepResult {
  failedPurchases: number;
  recoveredPurchases: number;
  rejectedVoids: number;
  resumedVoidCrashes: number;
  purgedQuotes: number;
}

// Shipping maintenance sweep (cron): resolve stale PURCHASING rows, reconcile
// async void refunds with the carrier, and purge expired quote rows.
export async function sweepShippingMaintenance(): Promise<ShippingSweepResult> {
  const cutoff = new Date(Date.now() - STUCK_PURCHASE_TTL_MINUTES * 60_000);
  const stuck = await prisma.shipment.findMany({ where: { status: "PURCHASING", createdAt: { lt: cutoff } } });
  let failedPurchases = 0;
  let recoveredPurchases = 0;
  for (const shipment of stuck) {
    const resolved = await resolveStuckShipment(shipment, null, `stuck PURCHASING past ${STUCK_PURCHASE_TTL_MINUTES} min`);
    if (resolved.status === "PURCHASED") recoveredPurchases += 1;
    else failedPurchases += 1;
  }

  let rejectedVoids = 0;
  const pendingVoids = await prisma.shipment.findMany({
    where: { status: "VOIDED", refundStatus: { in: ["QUEUED", "PENDING"] }, shippoRefundId: { not: null } },
  });
  for (const shipment of pendingVoids) {
    let refund;
    try {
      refund = await getRefund(shipment.shippoRefundId!);
    } catch (error) {
      // Carrier unreachable or unconfigured — the row stays honestly
      // VOIDED-pending and the next sweep retries.
      if (error instanceof ShippoNotConfiguredError) break;
      continue;
    }
    if (refund.status === "ERROR") {
      rejectedVoids += 1;
      const detail =
        refund.messages.map((message) => message.text).filter(Boolean).join("; ") || "carrier declined the refund";
      const activeNow = await prisma.shipment.findFirst({
        where: { packageId: shipment.packageId, status: { in: [...ACTIVE_SHIPMENT_STATUSES] } },
      });
      await prisma.$transaction(async (tx) => {
        // The void failed carrier-side — the label is still live and paid.
        // Revert when the package has no newer active label; if staff already
        // re-bought, the unique index forbids the revert and the event alone
        // flags the double cost for reconciliation.
        const row = await tx.shipment.update({
          where: { id: shipment.id },
          data: activeNow
            ? { refundStatus: refund.status }
            : { status: "PURCHASED", voidedAt: null, refundStatus: refund.status },
        });
        await writeEvent(tx, shipment.packageId, "label_void_rejected", null, {
          shipmentId: row.id,
          shippoRefundId: shipment.shippoRefundId,
          revertedToPurchased: activeNow === null,
          detail,
        });
      });
    } else {
      await prisma.shipment.update({ where: { id: shipment.id }, data: { refundStatus: refund.status } });
    }
  }

  // B1 reconciliation: a PURCHASED row carrying a shippoRefundId means the
  // carrier void succeeded but the local void(+flip) transaction crashed
  // before committing. The stored refund id is the proof — complete the local
  // marking WITHOUT calling the carrier again (the same discipline as
  // flipLabelPayment, which skips a second carrier call when referenceId
  // matches).
  let resumedVoidCrashes = 0;
  // Only a refund that still STANDS proves a crash (carrier void succeeded,
  // local commit failed). refundStatus ERROR means the carrier declined and
  // the rejected-voids leg deliberately reverted the row to PURCHASED —
  // resuming that would re-void a live, paid label.
  const crashedVoids = await prisma.shipment.findMany({
    where: { status: "PURCHASED", shippoRefundId: { not: null }, refundStatus: { in: ["QUEUED", "PENDING", "SUCCESS"] } },
    select: { id: true, packageId: true, shippoRefundId: true },
  });
  for (const row of crashedVoids) {
    await prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: row.id },
        data: { status: "VOIDED", voidedAt: new Date(), error: null },
      });
      await writeEvent(tx, row.packageId, "label_void", null, {
        shipmentId: row.id,
        refundId: row.shippoRefundId,
        note: "sweep completed the local void marking after a crash between the carrier void and the local commit",
      });
    });
    resumedVoidCrashes += 1;
  }

  const purged = await prisma.shippingQuote.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return { failedPurchases, recoveredPurchases, rejectedVoids, resumedVoidCrashes, purgedQuotes: purged.count };
}

export async function refreshTracking(input: { packageId: string; ctx: AuditContextLike }): Promise<Shipment> {
  // allowTerminal: R-176 tracking is the live operation once the carrier has
  // the package — refusing at SENT blocked the only stage where it matters.
  const pkg = await loadShippedPackage(input.packageId, { allowTerminal: true });
  const active = pickPurchasedShipment(pkg.shipments);
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
