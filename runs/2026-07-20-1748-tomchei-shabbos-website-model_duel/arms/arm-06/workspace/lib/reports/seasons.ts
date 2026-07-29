import { FulfillmentChoice } from "@prisma/client";
import { prisma } from "@/lib/db";

// R-091: multi-season performance reports. Revenue = POSTED payments only
// (voided rows never count — the payment ledger is the money truth, not
// order totals, so a refunded season stays honest). Every query is a
// bounded aggregate — this page must stay readable at crunch scale (G-024).

export interface SeasonPerformance {
  seasonId: string;
  seasonName: string;
  status: "OPEN" | "CLOSED";
  finalizedOrders: number;
  draftOrders: number;
  discardedOrders: number;
  packages: number;
  revenuePostedCents: number;
  deliveryFeesCents: number;
  avgOrderCents: number;
  // Per-fulfillment-channel package mix (PICKUP / BULK / PER_PACKAGE / SHIPPED).
  channelMix: { channel: FulfillmentChoice; packages: number }[];
}

export interface MethodDrillRow {
  channel: FulfillmentChoice;
  packages: number;
  deliveryFeesCents: number;
  shippedChargedCents: number;
}

export interface ProductDrillRow {
  productName: string;
  units: number;
  revenueCents: number;
}

export async function getSeasonPerformance(seasonIds?: string[]): Promise<SeasonPerformance[]> {
  const seasons = await prisma.season.findMany({
    where: seasonIds ? { id: { in: seasonIds } } : undefined,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const rows: SeasonPerformance[] = [];
  for (const season of seasons) {
    // Every aggregate below is keyed (seasonId, …): the loop supplies the
    // seasonId, each groupBy supplies its own second key (channel, choice) —
    // a row can never leak another season's numbers into this one.
    const [finalizedOrders, draftOrders, discardedOrders, packages, revenue, fees, channelGroups] =
      await Promise.all([
        prisma.order.count({ where: { seasonId: season.id, status: "FINALIZED" } }),
        prisma.order.count({ where: { seasonId: season.id, status: "DRAFT" } }),
        prisma.order.count({ where: { seasonId: season.id, status: "DISCARDED" } }),
        prisma.package.count({ where: { order: { seasonId: season.id, status: "FINALIZED" } } }),
        prisma.payment.aggregate({
          where: { order: { seasonId: season.id }, status: "POSTED" },
          _sum: { amountCents: true },
        }),
        prisma.draftRecipient.aggregate({
          where: { order: { seasonId: season.id, status: "FINALIZED" } },
          _sum: { deliveryFeeCents: true },
        }),
        prisma.package.groupBy({
          by: ["channel"],
          where: { order: { seasonId: season.id, status: "FINALIZED" } },
          _count: { _all: true },
        }),
      ]);
    const revenuePostedCents = revenue._sum.amountCents ?? 0;
    rows.push({
      seasonId: season.id,
      seasonName: season.name,
      status: season.status,
      finalizedOrders,
      draftOrders,
      discardedOrders,
      packages,
      revenuePostedCents,
      deliveryFeesCents: fees._sum.deliveryFeeCents ?? 0,
      avgOrderCents: finalizedOrders > 0 ? Math.round(revenuePostedCents / finalizedOrders) : 0,
      channelMix: channelGroups
        .map((group) => ({ channel: group.channel, packages: group._count._all }))
        .sort((a, b) => a.channel.localeCompare(b.channel)),
    });
  }
  return rows;
}

// Drill-down: per fulfillment method for one season. Delivery fees come from
// the frozen recipient snapshots; the shipped column books what customers
// were charged for labels (the margin ledger's charged side) — PURCHASED
// shipments only, exactly like getMarginRollup: a void returns the margin, so
// a VOIDED label's charge never counts here either.
export async function getMethodDrilldown(seasonId: string): Promise<MethodDrillRow[]> {
  const [packageGroups, feeGroups, shipmentGroups] = await Promise.all([
    prisma.package.groupBy({
      by: ["channel"],
      where: { order: { seasonId, status: "FINALIZED" } },
      _count: { _all: true },
    }),
    prisma.draftRecipient.groupBy({
      by: ["fulfillmentChoice"],
      where: { order: { seasonId, status: "FINALIZED" }, fulfillmentChoice: { not: null } },
      _sum: { deliveryFeeCents: true },
    }),
    prisma.shipment.groupBy({
      by: ["status"],
      where: { package: { order: { seasonId } }, status: "PURCHASED" },
      _sum: { chargedCents: true },
    }),
  ]);
  const feeByChoice = new Map(feeGroups.map((g) => [g.fulfillmentChoice, g._sum.deliveryFeeCents ?? 0]));
  const shippedCharged = shipmentGroups.reduce((sum, g) => sum + (g._sum.chargedCents ?? 0), 0);
  const channels = [...new Set([...packageGroups.map((g) => g.channel), ...feeByChoice.keys()])].filter(
    (c): c is FulfillmentChoice => c !== null,
  );
  return channels
    .map((channel) => ({
      channel,
      packages: packageGroups.find((g) => g.channel === channel)?._count._all ?? 0,
      deliveryFeesCents: feeByChoice.get(channel) ?? 0,
      shippedChargedCents: channel === "SHIPPED" ? shippedCharged : 0,
    }))
    .sort((a, b) => a.channel.localeCompare(b.channel));
}

// Drill-down: per-product units + revenue for one season (product lines only;
// add-on lines roll into the item-sales export, not this card).
export async function getProductDrilldown(seasonId: string, take = 25): Promise<ProductDrillRow[]> {
  const groups = await prisma.orderLine.groupBy({
    by: ["productName"],
    where: { order: { seasonId, status: "FINALIZED" }, productId: { not: null } },
    _sum: { qty: true, lineTotalCents: true },
    orderBy: { _sum: { lineTotalCents: "desc" } },
    take,
  });
  return groups.map((g) => ({
    productName: g.productName,
    units: g._sum.qty ?? 0,
    revenueCents: g._sum.lineTotalCents ?? 0,
  }));
}
