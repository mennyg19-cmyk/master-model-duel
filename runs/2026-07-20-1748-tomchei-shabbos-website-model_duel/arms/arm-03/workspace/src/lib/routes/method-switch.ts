import { AuditAction, PackageStage, ShippingLabelStatus } from "@prisma/client";
import { ApiError } from "@/lib/api-error";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { voidLabelForPackage } from "@/lib/shipping/labels";

const SHIP = "SHIP";
const DELIVERY_CODES = new Set([
  "DELIVERY",
  "BULK_DELIVERY",
  "PER_PACKAGE_DELIVERY",
]);

function isDelivery(code: string) {
  return DELIVERY_CODES.has(code.toUpperCase());
}

/**
 * Switch shipping ↔ delivery while preserving customer fulfillment charge (UR-002 / G-005).
 * Does not mutate Order.fulfillmentFeeCents / payment balance.
 */
export async function switchFulfillmentMethod(input: {
  seasonId: string;
  packageId: string;
  toMethodCode: string;
  actorId?: string | null;
}) {
  const toCode = input.toMethodCode.toUpperCase();
  const method = await db.fulfillmentMethod.findUnique({ where: { code: toCode } });
  if (!method?.isActive) throw new ApiError(`Unknown method ${toCode}`, 400);

  const pkg = await db.package.findFirst({
    where: { id: input.packageId, order: { seasonId: input.seasonId } },
    include: {
      fulfillmentMethod: true,
      order: true,
      routeStop: true,
      shippingLabels: { where: { status: ShippingLabelStatus.PURCHASED } },
    },
  });
  if (!pkg) throw new ApiError("Package not found", 404);
  if (pkg.stage === PackageStage.SENT || pkg.stage === PackageStage.PICKED_UP) {
    throw new ApiError("Cannot switch method after package is complete", 409);
  }
  if (pkg.routeStop && toCode === SHIP) {
    throw new ApiError("Remove from route before switching to shipping", 409);
  }

  const fromCode = pkg.fulfillmentMethod.code.toUpperCase();
  if (fromCode === toCode) {
    return {
      package: pkg,
      balancePreserved: true,
      fulfillmentFeeCents: pkg.order.fulfillmentFeeCents,
    };
  }

  const shipToDelivery = fromCode === SHIP && isDelivery(toCode);
  const deliveryToShip = isDelivery(fromCode) && toCode === SHIP;
  if (!shipToDelivery && !deliveryToShip) {
    throw new ApiError(`Unsupported switch ${fromCode} → ${toCode}`, 400);
  }

  const feeBefore = pkg.order.fulfillmentFeeCents;

  const updated = await db.$transaction(async (tx) => {
    if (shipToDelivery && pkg.shippingLabels.length > 0) {
      await voidLabelForPackage({
        packageId: pkg.id,
        actorId: input.actorId,
        seasonId: input.seasonId,
        tx,
      });
    }
    const next = await tx.package.update({
      where: { id: pkg.id },
      data: {
        fulfillmentMethodId: method.id,
        version: { increment: 1 },
      },
      include: { fulfillmentMethod: true, order: true },
    });
    // Intentionally do NOT change order.fulfillmentFeeCents — charge preserved.
    await writeAudit(
      {
        action: AuditAction.METHOD_SWITCHED,
        actorId: input.actorId,
        meta: {
          packageId: pkg.id,
          orderId: pkg.orderId,
          fromMethod: fromCode,
          toMethod: toCode,
          fulfillmentFeeCents: feeBefore,
          balancePreserved: true,
          who: input.actorId ?? null,
          when: new Date().toISOString(),
        },
      },
      tx,
    );
    return next;
  });

  return {
    package: updated,
    balancePreserved: true,
    fulfillmentFeeCents: feeBefore,
  };
}
