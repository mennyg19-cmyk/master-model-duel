import 'server-only';

import type { Season } from '@prisma/client';

import { db } from '../db';
import type { StaffOrderRow } from '../orders/staff-orders';

/**
 * What the office looks at first (R-049, R-050).
 *
 * The dashboard answers "how are we doing" and the Today queue answers "what is
 * waiting for me". They are separate on purpose: a count that is going up is
 * reassuring, and a list of five orders holding unpaid money is work. Every
 * figure here is scoped to the season being run, because a total that quietly
 * included last Purim would be worse than no total.
 */
export type DashboardKpis = {
  seasonLabel: string;
  ordersPlaced: number;
  ordersToday: number;
  itemsSoldCents: number;
  outstandingCents: number;
  unpaidOrders: number;
};

export type TodayQueue = {
  /** Placed and owing money — the calls the office makes first. */
  awaitingPayment: StaffOrderRow[];
  /** Paid and not yet moved into fulfillment. */
  readyToPack: StaffOrderRow[];
  /** Carts staff left open on their own tills. */
  openTills: { id: string; draftReference: string; customerName: string; itemCount: number }[];
};

const QUEUE_LIMIT = 8;

/**
 * The season the office is working in: the open one, or the most recent if the
 * store is between seasons. Both admin landing screens ask the same question, so
 * they ask it in the same words.
 */
export function readActiveSeason(): Promise<Season | null> {
  return db.season.findFirst({ orderBy: [{ status: 'asc' }, { year: 'desc' }] });
}

export async function readDashboard(seasonId: string, seasonLabel: string): Promise<DashboardKpis> {
  const [placed, today, money, unpaid] = await Promise.all([
    db.order.count({ where: { seasonId, status: { notIn: ['DRAFT', 'DISCARDED'] } } }),
    db.order.count({ where: { seasonId, placedAt: { gte: startOfToday() } } }),
    db.order.aggregate({
      where: { seasonId, status: { notIn: ['DRAFT', 'DISCARDED', 'CANCELLED'] } },
      _sum: { totalCents: true, amountPaidCents: true },
    }),
    db.order.count({
      where: {
        seasonId,
        status: { in: ['PLACED', 'IN_FULFILLMENT'] },
        paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
      },
    }),
  ]);

  const billed = money._sum.totalCents ?? 0;
  const collected = money._sum.amountPaidCents ?? 0;

  return {
    seasonLabel,
    ordersPlaced: placed,
    ordersToday: today,
    itemsSoldCents: billed,
    outstandingCents: Math.max(billed - collected, 0),
    unpaidOrders: unpaid,
  };
}

export async function readTodayQueue(seasonId: string): Promise<TodayQueue> {
  const [awaitingPayment, readyToPack, tills] = await Promise.all([
    db.order.findMany({
      where: {
        seasonId,
        status: { in: ['PLACED', 'IN_FULFILLMENT'] },
        paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
      },
      include: { customer: { select: { fullName: true } } },
      orderBy: [{ placedAt: 'asc' }, { id: 'asc' }],
      take: QUEUE_LIMIT,
    }),
    db.order.findMany({
      where: { seasonId, status: 'PLACED', paymentStatus: { in: ['PAID', 'OVERPAID'] } },
      include: { customer: { select: { fullName: true } } },
      orderBy: [{ placedAt: 'asc' }, { id: 'asc' }],
      take: QUEUE_LIMIT,
    }),
    db.order.findMany({
      where: { seasonId, status: 'DRAFT', posStaffUserId: { not: null } },
      include: { customer: { select: { fullName: true } }, _count: { select: { lines: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: QUEUE_LIMIT,
    }),
  ]);

  return {
    awaitingPayment: awaitingPayment.map(toRow),
    readyToPack: readyToPack.map(toRow),
    openTills: tills.map((row) => ({
      id: row.id,
      draftReference: row.draftReference,
      customerName: row.customer?.fullName ?? 'Guest',
      itemCount: row._count.lines,
    })),
  };
}

type QueueRow = {
  id: string;
  orderNumber: number | null;
  draftReference: string;
  status: StaffOrderRow['status'];
  paymentStatus: StaffOrderRow['paymentStatus'];
  totalCents: number;
  amountPaidCents: number;
  placedAt: Date | null;
  customer: { fullName: string } | null;
};

function toRow(order: QueueRow): StaffOrderRow {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    draftReference: order.draftReference,
    customerName: order.customer?.fullName ?? 'Guest',
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalCents: order.totalCents,
    amountPaidCents: order.amountPaidCents,
    placedAt: order.placedAt,
  };
}

/** Local midnight, because "today" is the office's day, not UTC's. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
