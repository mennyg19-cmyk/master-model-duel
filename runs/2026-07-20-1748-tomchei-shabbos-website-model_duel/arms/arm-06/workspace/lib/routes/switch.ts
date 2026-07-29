import { FulfillmentChoice, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { bulkAddressKey } from "@/lib/checkout/fulfillment";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { destinationSnapshotFor } from "@/lib/packages/destination";
import { buildGroupingKey } from "@/lib/packages/grouping";
import { methodCodeForChoice } from "@/lib/packages/materialize";
import { reprintBestEffort } from "@/lib/packages/print-batches";
import { PackageEventAction } from "@/lib/packages/stages";
import {
  ACTIVE_SHIPMENT_STATUSES,
  CarrierRefund,
  LabelVoidError,
  markLabelVoidedTx,
  persistVoidRefundMarker,
  requestLabelVoid,
  usableStoredRefund,
  voidCrashMessage,
} from "@/lib/shipping/labels";
import { getSetting } from "@/lib/settings";

// UR-002/G-005: switch a package between carrier shipping (P8) and local
// per-package delivery, both directions. THE CHARGE IS PRESERVED — the frozen
// recipient deliveryFeeCents and the paid order total are never touched; the
// audit row records the switch with the preserved charge so the ledger stays
// explainable. A printed-but-unshipped label voids through the P8 path before
// the flip (manager-confirmed); a SENT package refuses (the carrier has it).

export const switchableInclude = {
  fulfillmentMethod: true,
  recipientAddress: true,
  order: {
    select: {
      id: true,
      seasonId: true,
      season: { select: { status: true } },
      recipients: { select: { id: true, deliveryFeeCents: true } },
    },
  },
  lines: { include: { orderLine: { include: { recipient: true } } } },
  shipments: { where: { status: { in: [...ACTIVE_SHIPMENT_STATUSES] } } },
  routeStops: { include: { route: { select: { id: true, name: true, status: true } } } },
} satisfies Prisma.PackageInclude;

export type SwitchablePackage = Prisma.PackageGetPayload<{ include: typeof switchableInclude }>;

async function loadSwitchable(packageId: string): Promise<SwitchablePackage> {
  const pkg = await prisma.package.findUnique({ where: { id: packageId }, include: switchableInclude });
  if (!pkg) throw new NotFoundError("Package", packageId);
  // M6: closed season is a domain rule (409), not a missing package (404).
  if (pkg.order.season.status !== "OPEN") {
    throw new DomainRuleError(
      `Package ${packageId} belongs to a closed season; expected an open season to switch fulfillment methods`,
    );
  }
  return pkg;
}

// Shared switch/reroute pre-flight (m19): both verbs refuse a package sitting
// on an active route or with a label purchase stuck mid-flight, with the same
// wording law ("what is wrong + the expected state").
export function assertOffActiveRoute(pkg: SwitchablePackage, action: string): void {
  const activeStop = pkg.routeStops.find((stop) => stop.route.status === "PLANNED" || stop.route.status === "STARTED");
  if (activeStop) {
    throw new DomainRuleError(
      `Package ${pkg.id} is on route "${activeStop.route.name}" (${activeStop.route.status}); reassign it off the route before ${action}`,
    );
  }
}

export function assertNoStuckPurchase(pkg: SwitchablePackage, action: string): void {
  const stuck = pkg.shipments.find((shipment) => shipment.status === "PURCHASING");
  if (stuck) {
    throw new DomainRuleError(
      `Package ${pkg.id} has a label purchase stuck mid-flight; force-resolve it on the package page before ${action}`,
    );
  }
}

function assertSwitchable(pkg: SwitchablePackage): void {
  if (pkg.stage === pkg.fulfillmentMethod.terminalStage) {
    throw new DomainRuleError(
      `Package ${pkg.id} is ${pkg.stage} — already out the door; a method switch must happen before the terminal stage`,
    );
  }
  assertOffActiveRoute(pkg, "switching methods");
}

// The customer-facing charge that survives the switch: the member recipients'
// frozen fee snapshots (same ledger shape the P8 label buy reads).
export function preservedChargeCents(pkg: SwitchablePackage): number {
  const memberRecipientIds = new Set(
    pkg.lines.map((line) => line.orderLine.recipientId).filter((id): id is string => id !== null),
  );
  return pkg.order.recipients
    .filter((recipient) => memberRecipientIds.has(recipient.id))
    .reduce((sum, recipient) => sum + recipient.deliveryFeeCents, 0);
}

async function assertLabelVoidable(pkg: SwitchablePackage, confirmVoid: boolean | undefined): Promise<void> {
  assertNoStuckPurchase(pkg, "switching methods");
  const purchased = pkg.shipments.find((shipment) => shipment.status === "PURCHASED");
  if (purchased && !confirmVoid) {
    throw new DomainRuleError(
      `Package ${pkg.id} has a purchased label (${purchased.carrier} ${purchased.trackingNumber ?? ""}). Switching to delivery voids it — re-run with confirmVoid: true`,
    );
  }
}

export async function flipPackageChannelTx(
  tx: Prisma.TransactionClient,
  pkg: SwitchablePackage,
  to: FulfillmentChoice,
  deliveryDay: string | null,
): Promise<void> {
  const method = await tx.fulfillmentMethod.findFirst({ where: { code: methodCodeForChoice(to), active: true } });
  if (!method) {
    throw new DomainRuleError(`Fulfillment method ${methodCodeForChoice(to)} is missing or inactive; expected it to switch methods`);
  }
  const destination = to === "SHIPPED" ? destinationSnapshotFor(pkg) : null;
  const groupingKey = buildGroupingKey({
    recipientName: pkg.recipientName,
    recipientAddressId: pkg.recipientAddressId,
    fulfillmentMethodCode: method.code,
    greeting: pkg.greeting,
    ...(destination ? { addressKey: bulkAddressKey(destination) } : {}),
  });
  await tx.package.update({
    where: { id: pkg.id },
    data: {
      channel: to,
      fulfillmentMethodId: method.id,
      groupingKey,
      deliveryDay,
      version: { increment: 1 },
    },
  });
  const action: PackageEventAction = "method_switch";
  await tx.packageEvent.create({
    data: {
      packageId: pkg.id,
      action,
      metadata: { from: pkg.channel, to, deliveryDay },
    },
  });
}

export interface MethodSwitchResult {
  packageId: string;
  from: FulfillmentChoice;
  to: FulfillmentChoice;
  voidedShipmentId: string | null;
  preservedFeeCents: number;
}

export async function switchPackageMethod(input: {
  packageId: string;
  to: FulfillmentChoice;
  deliveryDay?: string;
  confirmVoid?: boolean;
  ctx: AuditContextLike;
}): Promise<MethodSwitchResult> {
  const pkg = await loadSwitchable(input.packageId);
  const pair: readonly FulfillmentChoice[] = ["SHIPPED", "PER_PACKAGE_DELIVERY"];
  if (!pair.includes(input.to) || pkg.channel === input.to || !pair.includes(pkg.channel)) {
    throw new DomainRuleError(
      `Method switch is SHIPPED <-> PER_PACKAGE_DELIVERY only; got ${pkg.channel} -> ${input.to}`,
    );
  }
  assertSwitchable(pkg);

  let deliveryDay: string | null = pkg.deliveryDay;
  if (input.to === "PER_PACKAGE_DELIVERY") {
    deliveryDay = input.deliveryDay ?? pkg.deliveryDay;
    const days = (await getSetting("delivery.days")) ?? [];
    if (!deliveryDay || !days.includes(deliveryDay)) {
      throw new DomainRuleError(
        `Switching to delivery needs one of the manager-set days (${days.join(", ") || "none configured"}); pass deliveryDay`,
      );
    }
    await assertLabelVoidable(pkg, input.confirmVoid);
  }

  // B1 atomic shape: the carrier void is the only irreversible call and can
  // never join a local transaction, so it happens FIRST; every local write
  // (void marking + channel flip + switch audit) then commits in ONE
  // transaction — no crash window leaves "label voided, package still
  // SHIPPED". A PURCHASED row already carrying a shippoRefundId means the
  // carrier void succeeded on an earlier crashed attempt: skip the carrier
  // call and complete locally from the stored refund id.
  const purchased = pkg.shipments.find((shipment) => shipment.status === "PURCHASED");
  let refund: CarrierRefund | null = null;
  if (input.to === "PER_PACKAGE_DELIVERY" && purchased) {
    const storedRefund = usableStoredRefund(purchased);
    if (!purchased.shippoTransactionId && !storedRefund) {
      throw new LabelVoidError("the purchased label is missing its carrier transaction id");
    }
    refund = storedRefund ?? (await requestLabelVoid(purchased.shippoTransactionId!));
  }

  const preservedFeeCents = preservedChargeCents(pkg);
  let voidedShipmentId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      if (purchased && refund) {
        const voided = await markLabelVoidedTx(tx, {
          active: purchased,
          refund,
          packageId: pkg.id,
          actorId: input.ctx.staff.id,
          reason: "method switch to local delivery (UR-002)",
          ctx: input.ctx,
        });
        voidedShipmentId = voided.id;
      }
      await flipPackageChannelTx(tx, pkg, input.to, deliveryDay);
      await recordAudit(
        {
          ctx: input.ctx,
          action: "method_switch",
          targetType: "Package",
          targetId: pkg.id,
          metadata: { from: pkg.channel, to: input.to, deliveryDay, voidedShipmentId, preservedFeeCents },
        },
        tx,
      );
    });
  } catch (persistError) {
    // The carrier void succeeded but the local void+flip failed — mark the
    // refund id on the row so a retry resumes WITHOUT a second carrier call
    // and the shipping sweep can reconcile even without one (B1).
    if (purchased && refund) {
      const detail = persistError instanceof Error ? persistError.message : String(persistError);
      await persistVoidRefundMarker(purchased, refund, detail);
      throw new LabelVoidError(voidCrashMessage(refund, detail));
    }
    throw persistError;
  }

  // Keep the print room honest: the order's printed artifacts re-file under
  // the new channel (m17 shared helper).
  await reprintBestEffort(pkg.order.id, input.ctx.staff.id);

  return { packageId: pkg.id, from: pkg.channel, to: input.to, voidedShipmentId, preservedFeeCents };
}
