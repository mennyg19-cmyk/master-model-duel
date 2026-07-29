import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// R-049/R-050: dashboard KPIs + the Today work queue. Everything is scoped to
// the open season and every query is bounded — the dashboard must stay fast at
// crunch scale (G-024) because it is the page staff land on all day.
const QUEUE_TAKE = 10;

export interface DashboardKpis {
  ordersToday: number;
  revenueTodayCents: number;
  awaitingCollection: number;
  inFlightCheckouts: number;
}

export interface QueueOrder {
  id: string;
  label: string;
  customerName: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  totalCents: number;
  createdAt: Date;
}

export interface DashboardData {
  kpis: DashboardKpis;
  // FINALIZED with money still owed — oldest first, the collection list.
  collectQueue: QueueOrder[];
  // Submitted drafts (checkout done, stock reserved) waiting on payment.
  inFlightQueue: QueueOrder[];
  recentOrders: QueueOrder[];
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

const queueSelect = {
  id: true,
  orderNumber: true,
  draftRef: true,
  status: true,
  paymentStatus: true,
  totalCents: true,
  createdAt: true,
  customer: { select: { name: true } },
} satisfies Prisma.OrderSelect;

type QueueRow = Prisma.OrderGetPayload<{ select: typeof queueSelect }>;

function toQueueOrder(row: QueueRow): QueueOrder {
  return {
    id: row.id,
    label: row.orderNumber === null ? (row.draftRef ?? row.id) : `#${row.orderNumber}`,
    customerName: row.customer.name,
    status: row.status,
    paymentStatus: row.paymentStatus,
    totalCents: row.totalCents,
    createdAt: row.createdAt,
  };
}

export async function getDashboardData(seasonId: string | null): Promise<DashboardData> {
  if (!seasonId) {
    return {
      kpis: { ordersToday: 0, revenueTodayCents: 0, awaitingCollection: 0, inFlightCheckouts: 0 },
      collectQueue: [],
      inFlightQueue: [],
      recentOrders: [],
    };
  }

  const today = startOfToday();
  const [ordersToday, revenueToday, awaitingCollection, inFlightCheckouts, collectRows, inFlightRows, recentRows] =
    await Promise.all([
      prisma.order.count({ where: { seasonId, status: "FINALIZED", updatedAt: { gte: today } } }),
      prisma.payment.aggregate({
        where: { order: { seasonId }, status: "POSTED", createdAt: { gte: today } },
        _sum: { amountCents: true },
      }),
      prisma.order.count({
        where: { seasonId, status: "FINALIZED", paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
      }),
      prisma.order.count({ where: { seasonId, status: "DRAFT", stockReserved: true } }),
      prisma.order.findMany({
        where: { seasonId, status: "FINALIZED", paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: QUEUE_TAKE,
        select: queueSelect,
      }),
      prisma.order.findMany({
        where: { seasonId, status: "DRAFT", stockReserved: true },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: QUEUE_TAKE,
        select: queueSelect,
      }),
      prisma.order.findMany({
        where: { seasonId, status: { not: "DISCARDED" } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: QUEUE_TAKE,
        select: queueSelect,
      }),
    ]);

  return {
    kpis: {
      ordersToday,
      revenueTodayCents: revenueToday._sum.amountCents ?? 0,
      awaitingCollection,
      inFlightCheckouts,
    },
    collectQueue: collectRows.map(toQueueOrder),
    inFlightQueue: inFlightRows.map(toQueueOrder),
    recentOrders: recentRows.map(toQueueOrder),
  };
}
