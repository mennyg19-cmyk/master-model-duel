import {
  AuditAction,
  CachedPaymentStatus,
  OrderStatus,
  PackageStage,
  PaymentMethod,
  PaymentState,
  Prisma,
  ShippingLabelStatus,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { formatDraftRef } from "@/lib/orders/draft-wire";
import { buildGroupingKey } from "@/lib/orders/grouping";
import { finalizeOrder } from "@/lib/orders/finalize";
import { transitionPackage } from "@/lib/orders/package-stages";
import { runNightlyPrintBatch } from "@/lib/ops/print-batch";
import { err, maskError, ok, type Result } from "@/lib/result";
import { isTestEnvAllowed } from "@/lib/ops/test-ops";

/**
 * End-to-end dress rehearsal:
 * order → pay → print (while NEW) → package → ship/deliver/pickup → reports.
 * Snapshot markers match wipeTestFixtures (dressRehearsal + p12Fixture).
 */
export async function runDressRehearsal(input?: {
  staffId?: string | null;
}): Promise<
  Result<{
    orderId: string;
    packageIds: { ship: string; deliver: string; pickup: string };
    printBatchId: string | null;
    marginCents: number;
    reportRevenueCents: number;
  }>
> {
  try {
    if (!isTestEnvAllowed()) {
      return err("test_env", "Dress rehearsal is only available in IS_TEST_ENV / AUTH_MODE=dev.");
    }
    const season = await db.season.findFirst({
      where: { status: "OPEN" },
      orderBy: { year: "desc" },
    });
    if (!season) return err("season", "No open season.");

    const customer = await db.customer.findFirst({
      where: { email: "customer@tomchei.local" },
    });
    if (!customer) return err("customer", "Seed customer missing.");

    const product = await db.product.findFirst({
      where: { seasonId: season.id, sku: "FAMILY-BOX", isActive: true },
    });
    if (!product) return err("product", "FAMILY-BOX missing.");

    const methods = await db.fulfillmentMethod.findMany({ where: { isActive: true } });
    const byCode = new Map(methods.map((m) => [m.code, m]));
    const ship = byCode.get("SHIP");
    const deliver = byCode.get("PER_PACKAGE_DELIVERY") ?? byCode.get("BULK_DELIVERY");
    const pickup = byCode.get("PICKUP");
    if (!ship || !deliver || !pickup) {
      return err("methods", "Need SHIP, delivery, and PICKUP methods.");
    }

    await db.inventoryItem.upsert({
      where: { productId: product.id },
      create: { productId: product.id, onHand: 100, reserved: 0 },
      update: { onHand: { increment: 20 } },
    });

    const greeting = "Dress rehearsal";
    const mkLine = (
      recipientName: string,
      addressLine1: string,
      methodId: string,
      methodCode: string,
    ) => {
      const groupingKey = buildGroupingKey({
        recipientName,
        addressLine1,
        city: "Brooklyn",
        state: "NY",
        postalCode: "11218",
        fulfillmentMethodCode: methodCode,
        greeting,
      });
      return {
        productId: product.id,
        quantity: 1,
        unitPriceCents: product.basePriceCents,
        recipientName,
        addressLine1,
        city: "Brooklyn",
        state: "NY",
        postalCode: "11218",
        country: "US",
        fulfillmentMethodId: methodId,
        greeting,
        groupingKey,
      };
    };

    const draftRef = formatDraftRef(
      season.year,
      `dr${randomBytes(4).toString("hex")}`,
    );

    const draft = await db.order.create({
      data: {
        seasonId: season.id,
        customerId: customer.id,
        status: OrderStatus.DRAFT,
        draftRef,
        greetingDefault: greeting,
        expectedTotalCents: product.basePriceCents * 3,
        checkoutSnapshot: {
          dressRehearsal: true,
          p12Fixture: true,
          scaleFixture: "p12",
        } as Prisma.InputJsonValue,
        lines: {
          create: [
            mkLine("DR Ship", "10 Dress Ship St", ship.id, ship.code),
            mkLine("DR Deliver", "20 Dress Deliver Ave", deliver.id, deliver.code),
            mkLine("DR Pickup", "30 Dress Pickup Rd", pickup.id, pickup.code),
          ],
        },
      },
    });

    const finalized = await finalizeOrder(draft.id, input?.staffId);
    if (!finalized.ok) return err(finalized.error, finalized.publicMessage);

    const amount = product.basePriceCents * 3;
    await db.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId: draft.id,
          method: PaymentMethod.CASH,
          state: PaymentState.POSTED,
          amountCents: amount,
          reference: `dress-${draft.id}`,
          postedById: input?.staffId ?? null,
        },
      });
      await tx.order.update({
        where: { id: draft.id },
        data: {
          status: OrderStatus.PAID,
          paymentStatusCached: CachedPaymentStatus.PAID,
          expectedTotalCents: amount,
        },
      });
      await writeAudit(
        {
          action: AuditAction.ORDER_PAID,
          actorId: input?.staffId ?? null,
          meta: { orderId: draft.id, dressRehearsal: true },
        },
        tx,
      );
    });

    const packages = await db.package.findMany({
      where: { orderId: draft.id },
      include: { fulfillmentMethod: true },
    });
    const shipPkg = packages.find((p) => p.fulfillmentMethod.code === ship.code);
    const deliverPkg = packages.find((p) => p.fulfillmentMethod.code === deliver.code);
    const pickupPkg = packages.find((p) => p.fulfillmentMethod.code === pickup.code);
    if (!shipPkg || !deliverPkg || !pickupPkg) {
      return err("packages", "Expected three packages after finalize.");
    }

    const seasonId = season.id;
    const print = await runNightlyPrintBatch({
      seasonId,
      actorId: input?.staffId ?? null,
      day: `dress-${draft.id.slice(-6)}`,
    });
    const printBatchId = print.ok ? print.value.batchId : null;

    async function advanceTo(
      packageId: string,
      terminal: PackageStage,
    ): Promise<Result<{ package: { version: number } }>> {
      let current = await db.package.findUniqueOrThrow({ where: { id: packageId } });
      for (const stage of [PackageStage.PRINTED, PackageStage.PACKED, terminal]) {
        const next = await transitionPackage(
          seasonId,
          packageId,
          stage,
          input?.staffId,
          current.version,
        );
        if (!next.ok) return next;
        current = next.value.package;
      }
      return ok({ package: current });
    }

    const shipAdv = await advanceTo(shipPkg.id, PackageStage.SENT);
    if (!shipAdv.ok) return err(shipAdv.error, shipAdv.publicMessage);
    const deliverAdv = await advanceTo(deliverPkg.id, PackageStage.SENT);
    if (!deliverAdv.ok) return err(deliverAdv.error, deliverAdv.publicMessage);
    const pickupAdv = await advanceTo(pickupPkg.id, PackageStage.PICKED_UP);
    if (!pickupAdv.ok) return err(pickupAdv.error, pickupAdv.publicMessage);

    await db.shippingLabel.create({
      data: {
        packageId: shipPkg.id,
        orderId: draft.id,
        status: ShippingLabelStatus.PURCHASED,
        carrier: "ups",
        serviceLevel: "ground",
        chargedCents: 1200,
        purchasedCents: 900,
        marginCents: 300,
        quotesJson: { dress: true },
        trackingNumber: `DR${randomBytes(4).toString("hex").toUpperCase()}`,
        idempotencyKey: `dress-label-${shipPkg.id}`,
        routeAssignedAt: new Date(),
      },
    });

    const margin = await db.shippingLabel.aggregate({
      where: { orderId: draft.id, status: ShippingLabelStatus.PURCHASED },
      _sum: { marginCents: true },
    });
    const payments = await db.payment.aggregate({
      where: { orderId: draft.id, state: PaymentState.POSTED },
      _sum: { amountCents: true },
    });

    await writeAudit({
      action: AuditAction.TEST_OPS_ACTION,
      actorId: input?.staffId ?? null,
      meta: { action: "dressRehearsal", orderId: draft.id },
    });

    return ok({
      orderId: draft.id,
      packageIds: {
        ship: shipPkg.id,
        deliver: deliverPkg.id,
        pickup: pickupPkg.id,
      },
      printBatchId,
      marginCents: margin._sum.marginCents ?? 0,
      reportRevenueCents: payments._sum.amountCents ?? 0,
    });
  } catch (error) {
    return err(maskError(error), "Dress rehearsal failed.");
  }
}
