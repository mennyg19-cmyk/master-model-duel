import { type CachedPaymentStatus, type OrderStatus, Prisma } from "@prisma/client";
import { repeatOrdersInBulk } from "@/domain/repeat-orders";
import { db } from "@/lib/db";

export const ADMIN_PAGE_SIZE = 25;

export type OrderFilters = {
  page?: number;
  query?: string;
  status?: OrderStatus;
  payment?: CachedPaymentStatus;
};

export async function listOrders(filters: OrderFilters) {
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const query = filters.query?.trim();
  const orderNumber = query && /^\d+$/.test(query) ? Number(query) : undefined;
  const where: Prisma.OrderWhereInput = {
    status: filters.status,
    cachedPaymentStatus: filters.payment,
    ...(query
      ? {
          OR: [
            { draftReference: { contains: query, mode: "insensitive" } },
            ...(orderNumber ? [{ orderNumber }] : []),
            { customer: { displayName: { contains: query, mode: "insensitive" } } },
            { customer: { email: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      include: {
        customer: { select: { id: true, displayName: true, email: true } },
        _count: { select: { lines: true, packages: true } },
      },
    }),
    db.order.count({ where }),
  ]);
  return { orders, total, page, pages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)) };
}

export async function getOperationsDashboard() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentSeasonSetting = await db.appSetting.findUnique({
    where: { key: "current-season-id" },
  });
  const currentSeasonId =
    typeof currentSeasonSetting?.value === "string"
      ? currentSeasonSetting.value
      : null;
  const [orderCount, todayCount, unpaidCount, gross, recentOrders] = await Promise.all([
    db.order.count({ where: { status: "FINALIZED" } }),
    db.order.count({ where: { createdAt: { gte: today } } }),
    db.order.count({
      where: {
        status: "FINALIZED",
        cachedPaymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] },
      },
    }),
    db.order.aggregate({
      where: {
        status: "FINALIZED",
        seasonId: currentSeasonId ?? "__no-current-season__",
      },
      _sum: { totalCents: true },
    }),
    db.order.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 8,
      include: { customer: { select: { displayName: true } } },
    }),
  ]);
  return {
    orderCount,
    todayCount,
    unpaidCount,
    grossCents: gross._sum.totalCents ?? 0,
    recentOrders,
  };
}

export function getTodayQueue() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return db.order.findMany({
    where: {
      OR: [
        { createdAt: { gte: today } },
        {
          status: "FINALIZED",
          cachedPaymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] },
        },
      ],
    },
    orderBy: [
      { cachedPaymentStatus: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    take: 100,
    include: {
      customer: { select: { displayName: true, email: true, phone: true } },
      _count: { select: { lines: true, packages: true } },
    },
  });
}

export function getOrderDetail(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { include: { addresses: { orderBy: { recipientName: "asc" } } } },
      season: { select: { name: true } },
      lines: {
        include: {
          product: { select: { name: true } },
          recipientAddress: true,
          fulfillmentMethod: true,
          addOns: true,
        },
        orderBy: { id: "asc" },
      },
      payments: { orderBy: [{ postedAt: "desc" }, { id: "asc" }] },
      paymentIntents: { orderBy: { createdAt: "desc" } },
      packages: {
        orderBy: { createdAt: "asc" },
        include: {
          fulfillmentMethod: true,
          shippingQuotes: {
            where: { expiresAt: { gt: new Date() } },
            orderBy: { amountCents: "asc" },
          },
          shippingLabels: {
            where: { status: "PURCHASED" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
}

export function repeatOrders(
  actorStaffId: string,
  requestedSources: { orderId: string; version: number }[],
) {
  return repeatOrdersInBulk(db, actorStaffId, requestedSources);
}

