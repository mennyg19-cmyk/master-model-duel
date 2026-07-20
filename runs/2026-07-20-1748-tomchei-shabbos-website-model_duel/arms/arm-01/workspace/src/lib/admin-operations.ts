import { randomBytes } from "node:crypto";
import { type CachedPaymentStatus, type OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const ADMIN_PAGE_SIZE = 25;
export const MAX_BULK_ORDERS = 50;

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

export async function repeatOrders(
  actorStaffId: string,
  requestedSources: { orderId: string; version: number }[],
) {
  if (requestedSources.length > MAX_BULK_ORDERS) {
    throw new Error(`Bulk repeat accepts at most ${MAX_BULK_ORDERS} orders.`);
  }
  const sortedSources = [...requestedSources].sort((left, right) =>
    left.orderId.localeCompare(right.orderId),
  );
  const seen = new Set<string>();
  const applied: { sourceOrderId: string; draftOrderId: string }[] = [];
  const conflicts: { orderId: string; reason: string }[] = [];

  for (const requested of sortedSources) {
    if (seen.has(requested.orderId)) {
      conflicts.push({ orderId: requested.orderId, reason: "duplicate request" });
      continue;
    }
    seen.add(requested.orderId);
    const repeated = await db.$transaction(async (transaction) => {
      const source = await transaction.order.findFirst({
        where: {
          id: requested.orderId,
          version: requested.version,
          status: "FINALIZED",
        },
        include: {
          lines: { include: { addOns: true } },
        },
      });
      if (!source) return null;
      const draft = await transaction.order.create({
        data: {
          seasonId: source.seasonId,
          customerId: source.customerId,
          draftReference: `R-${source.id.slice(-8)}-${randomBytes(4).toString("hex")}`,
          subtotalCents: source.subtotalCents,
          donationCents: source.donationCents,
          totalCents: source.totalCents,
          defaultGreeting: source.defaultGreeting,
          lines: {
            create: source.lines.map((line) => ({
              productId: line.productId,
              productOptionId: line.productOptionId,
              recipientAddressId: line.recipientAddressId,
              recipientSource: line.recipientSource,
              recipientNameSnapshot: line.recipientNameSnapshot,
              fulfillmentMethodId: line.fulfillmentMethodId,
              fulfillmentFeeCentsSnapshot: line.fulfillmentFeeCentsSnapshot,
              greetingSnapshot: line.greetingSnapshot,
              deliveryDay: line.deliveryDay,
              productNameSnapshot: line.productNameSnapshot,
              skuSnapshot: line.skuSnapshot,
              unitPriceCentsSnapshot: line.unitPriceCentsSnapshot,
              quantity: line.quantity,
              addOns: {
                create: line.addOns.map((addOn) => ({
                  addOnProductId: addOn.addOnProductId,
                  addOnNameSnapshot: addOn.addOnNameSnapshot,
                  unitPriceCentsSnapshot: addOn.unitPriceCentsSnapshot,
                  quantity: addOn.quantity,
                })),
              },
            })),
          },
        },
      });
      await transaction.auditLog.create({
        data: {
          actorStaffId,
          action: "order.repeated",
          targetType: "Order",
          targetId: draft.id,
          metadata: { sourceOrderId: source.id, sourceVersion: source.version },
        },
      });
      return draft;
    });
    if (repeated) {
      applied.push({ sourceOrderId: requested.orderId, draftOrderId: repeated.id });
    } else {
      conflicts.push({
        orderId: requested.orderId,
        reason: "source missing, changed, or not finalized",
      });
    }
  }
  return { applied, conflicts };
}
