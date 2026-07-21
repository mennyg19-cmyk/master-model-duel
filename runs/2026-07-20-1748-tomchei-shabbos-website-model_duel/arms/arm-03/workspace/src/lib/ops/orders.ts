import {
  CachedPaymentStatus,
  OrderStatus,
  type Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export type OrderListFilters = {
  q?: string;
  status?: OrderStatus;
  paymentStatus?: CachedPaymentStatus;
  seasonId?: string;
  page?: number;
  pageSize?: number;
};

export function clampPageSize(raw?: number): number {
  if (!raw || raw < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.floor(raw));
}

/** Bounded, searchable order list (R-052, R-105). */
export async function listOrders(filters: OrderListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = clampPageSize(filters.pageSize);
  const where: Prisma.OrderWhereInput = {
    status: { not: OrderStatus.DISCARDED },
  };
  if (filters.status) where.status = filters.status;
  if (filters.paymentStatus) where.paymentStatusCached = filters.paymentStatus;
  if (filters.seasonId) where.seasonId = filters.seasonId;

  const q = filters.q?.trim();
  if (q) {
    const asNumber = Number.parseInt(q, 10);
    where.OR = [
      ...(Number.isFinite(asNumber) ? [{ orderNumber: asNumber }] : []),
      { draftRef: { contains: q, mode: "insensitive" } },
      { customer: { displayName: { contains: q, mode: "insensitive" } } },
      { customer: { email: { contains: q, mode: "insensitive" } } },
      { customer: { phone: { contains: q, mode: "insensitive" } } },
      { id: { equals: q } },
    ];
  }

  const [total, rows] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({
      where,
      include: {
        customer: { select: { id: true, displayName: true, email: true, phone: true } },
        season: { select: { id: true, name: true, year: true } },
        _count: { select: { lines: true, packages: true, payments: true } },
      },
      orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    orders: rows,
  };
}

export async function getOrderDetail(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      season: true,
      lines: {
        include: {
          product: true,
          productOption: true,
          addOns: { include: { addOn: true } },
          fulfillmentMethod: true,
        },
        orderBy: { createdAt: "asc" },
      },
      payments: {
        include: {
          postedBy: { select: { id: true, displayName: true } },
          voidedBy: { select: { id: true, displayName: true } },
        },
        orderBy: { postedAt: "desc" },
      },
      packages: {
        orderBy: { createdAt: "asc" },
        include: { fulfillmentMethod: { select: { id: true, code: true, label: true } } },
      },
      stripeSessions: true,
      stripeIntents: true,
    },
  });
}

/** Dashboard KPIs + recent orders (R-049). */
export async function dashboardKpis() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    placedToday,
    unpaidOpen,
    paidOpen,
    recent,
  ] = await Promise.all([
    db.order.count({
      where: {
        placedAt: { gte: startOfDay },
        status: { notIn: [OrderStatus.DRAFT, OrderStatus.DISCARDED] },
      },
    }),
    db.order.count({
      where: {
        status: { in: [OrderStatus.PLACED, OrderStatus.PAID, OrderStatus.FULFILLING] },
        paymentStatusCached: { in: [CachedPaymentStatus.UNPAID, CachedPaymentStatus.PARTIAL] },
      },
    }),
    db.order.count({
      where: {
        status: { in: [OrderStatus.PAID, OrderStatus.FULFILLING] },
        paymentStatusCached: CachedPaymentStatus.PAID,
      },
    }),
    db.order.findMany({
      where: { status: { notIn: [OrderStatus.DRAFT, OrderStatus.DISCARDED] } },
      include: {
        customer: { select: { displayName: true, email: true } },
      },
      orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
      take: 8,
    }),
  ]);

  return { placedToday, unpaidOpen, paidOpen, recent };
}

/** Today work queue — placed/paid needing attention (R-050). */
export async function todayWorkQueue(limit = 40) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return db.order.findMany({
    where: {
      OR: [
        { placedAt: { gte: startOfDay } },
        {
          status: { in: [OrderStatus.PLACED, OrderStatus.PAID] },
          paymentStatusCached: {
            in: [CachedPaymentStatus.UNPAID, CachedPaymentStatus.PARTIAL, CachedPaymentStatus.PAID],
          },
        },
      ],
      status: { notIn: [OrderStatus.DRAFT, OrderStatus.DISCARDED, OrderStatus.CANCELLED] },
    },
    include: {
      customer: { select: { id: true, displayName: true, email: true } },
      _count: { select: { packages: true, lines: true } },
    },
    orderBy: [{ placedAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(100, Math.max(1, limit)),
  });
}
