import { Prisma, ShipmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

// UR-003 report: the shipping-margin reconciliation view. The ledger is the
// P8 money triple on Shipment — charged (what the customer paid for the
// label, frozen at checkout), cost (what the carrier label actually cost),
// margin (the spread the org keeps). VOIDED rows stay visible with their
// pre-void numbers struck out of the totals: a void returns the margin, so
// only PURCHASED shipments count in rollups.

export interface MarginRow {
  shipmentId: string;
  seasonName: string;
  orderId: string;
  orderLabel: string;
  recipientName: string;
  carrier: string | null;
  serviceLevel: string | null;
  status: ShipmentStatus;
  chargedCents: number;
  costCents: number | null;
  marginCents: number | null;
  createdAt: Date;
}

export interface MarginRollup {
  shipments: number;
  chargedCents: number;
  costCents: number;
  marginCents: number;
  byCarrier: { carrier: string; shipments: number; chargedCents: number; costCents: number; marginCents: number }[];
}

const rowSelect = {
  id: true,
  status: true,
  carrier: true,
  serviceLevel: true,
  chargedCents: true,
  costCents: true,
  marginCents: true,
  createdAt: true,
  package: {
    select: {
      recipientName: true,
      order: {
        select: { id: true, orderNumber: true, draftRef: true, season: { select: { name: true } } },
      },
    },
  },
} satisfies Prisma.ShipmentSelect;

type MarginRowPayload = Prisma.ShipmentGetPayload<{ select: typeof rowSelect }>;

function toMarginRow(row: MarginRowPayload): MarginRow {
  return {
    shipmentId: row.id,
    seasonName: row.package.order.season.name,
    orderId: row.package.order.id,
    orderLabel: row.package.order.orderNumber === null ? (row.package.order.draftRef ?? row.id) : `#${row.package.order.orderNumber}`,
    recipientName: row.package.recipientName,
    carrier: row.carrier,
    serviceLevel: row.serviceLevel,
    status: row.status,
    chargedCents: row.chargedCents,
    costCents: row.costCents,
    marginCents: row.marginCents,
    createdAt: row.createdAt,
  };
}

export async function getMarginRows(input: { seasonId?: string; take?: number }): Promise<MarginRow[]> {
  const rows = await prisma.shipment.findMany({
    where: input.seasonId ? { package: { order: { seasonId: input.seasonId } } } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.take ?? 200,
    select: rowSelect,
  });
  return rows.map(toMarginRow);
}

// Rollups count PURCHASED shipments only — VOIDED labels refunded the cost
// and returned the margin, so including them would double-book the spread.
export async function getMarginRollup(seasonId?: string): Promise<MarginRollup> {
  const where: Prisma.ShipmentWhereInput = {
    status: "PURCHASED",
    ...(seasonId ? { package: { order: { seasonId } } } : {}),
  };
  const [totals, carrierGroups] = await Promise.all([
    prisma.shipment.aggregate({
      where,
      _count: { _all: true },
      _sum: { chargedCents: true, costCents: true, marginCents: true },
    }),
    prisma.shipment.groupBy({
      by: ["carrier"],
      where,
      _count: { _all: true },
      _sum: { chargedCents: true, costCents: true, marginCents: true },
    }),
  ]);
  return {
    shipments: totals._count._all,
    chargedCents: totals._sum.chargedCents ?? 0,
    costCents: totals._sum.costCents ?? 0,
    marginCents: totals._sum.marginCents ?? 0,
    byCarrier: carrierGroups
      .map((g) => ({
        carrier: g.carrier ?? "unknown",
        shipments: g._count._all,
        chargedCents: g._sum.chargedCents ?? 0,
        costCents: g._sum.costCents ?? 0,
        marginCents: g._sum.marginCents ?? 0,
      }))
      .sort((a, b) => a.carrier.localeCompare(b.carrier)),
  };
}
