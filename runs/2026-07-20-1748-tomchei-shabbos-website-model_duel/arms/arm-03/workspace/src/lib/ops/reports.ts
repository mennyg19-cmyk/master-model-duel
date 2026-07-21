import {
  CachedPaymentStatus,
  OrderStatus,
  ShippingLabelStatus,
} from "@prisma/client";
import { db } from "@/lib/db";

export type SeasonPerformance = {
  seasonId: string;
  name: string;
  year: number;
  slug: string;
  orderCount: number;
  paidOrderCount: number;
  revenueCents: number;
  packageCount: number;
  byMethod: Record<string, number>;
};

export type MarginReport = {
  seasonId: string | null;
  labelCount: number;
  chargedCents: number;
  purchasedCents: number;
  marginCents: number;
  packages: Array<{
    packageId: string;
    orderId: string;
    chargedCents: number;
    purchasedCents: number;
    marginCents: number;
    carrier: string;
  }>;
};

/** Multi-season performance + drill-downs (R-091). */
export async function performanceReport(opts?: {
  seasonIds?: string[];
}): Promise<SeasonPerformance[]> {
  const seasons = await db.season.findMany({
    where: opts?.seasonIds?.length ? { id: { in: opts.seasonIds } } : undefined,
    orderBy: [{ year: "desc" }, { name: "asc" }],
  });

  const out: SeasonPerformance[] = [];
  for (const season of seasons) {
    const orders = await db.order.findMany({
      where: {
        seasonId: season.id,
        status: { notIn: [OrderStatus.DRAFT, OrderStatus.DISCARDED] },
      },
      select: {
        id: true,
        status: true,
        paymentStatusCached: true,
        expectedTotalCents: true,
        packages: {
          select: {
            id: true,
            fulfillmentMethod: { select: { code: true } },
          },
        },
        payments: {
          where: { state: "POSTED" },
          select: { amountCents: true, refundedCents: true },
        },
      },
    });

    const byMethod: Record<string, number> = {};
    let packageCount = 0;
    let revenueCents = 0;
    let paidOrderCount = 0;

    for (const order of orders) {
      const paid =
        order.paymentStatusCached === CachedPaymentStatus.PAID ||
        order.status === OrderStatus.PAID;
      if (paid) paidOrderCount += 1;
      const posted = order.payments.reduce(
        (sum, p) => sum + p.amountCents - p.refundedCents,
        0,
      );
      revenueCents += posted || (paid ? order.expectedTotalCents ?? 0 : 0);
      for (const pkg of order.packages) {
        packageCount += 1;
        const code = pkg.fulfillmentMethod.code;
        byMethod[code] = (byMethod[code] ?? 0) + 1;
      }
    }

    out.push({
      seasonId: season.id,
      name: season.name,
      year: season.year,
      slug: season.slug,
      orderCount: orders.length,
      paidOrderCount,
      revenueCents,
      packageCount,
      byMethod,
    });
  }
  return out;
}

/** Shipping-margin reconciliation — charged vs paid per package (UR-003). */
export async function marginReport(opts?: {
  seasonId?: string;
}): Promise<MarginReport> {
  const labels = await db.shippingLabel.findMany({
    where: {
      status: ShippingLabelStatus.PURCHASED,
      ...(opts?.seasonId
        ? { order: { seasonId: opts.seasonId } }
        : undefined),
    },
    select: {
      packageId: true,
      orderId: true,
      chargedCents: true,
      purchasedCents: true,
      marginCents: true,
      carrier: true,
    },
    orderBy: { createdAt: "asc" },
  });

  let chargedCents = 0;
  let purchasedCents = 0;
  let marginCents = 0;
  const packages = labels.map((label) => {
    chargedCents += label.chargedCents;
    purchasedCents += label.purchasedCents;
    marginCents += label.marginCents;
    return {
      packageId: label.packageId,
      orderId: label.orderId,
      chargedCents: label.chargedCents,
      purchasedCents: label.purchasedCents,
      marginCents: label.marginCents,
      carrier: label.carrier,
    };
  });

  return {
    seasonId: opts?.seasonId ?? null,
    labelCount: labels.length,
    chargedCents,
    purchasedCents,
    marginCents,
    packages,
  };
}
