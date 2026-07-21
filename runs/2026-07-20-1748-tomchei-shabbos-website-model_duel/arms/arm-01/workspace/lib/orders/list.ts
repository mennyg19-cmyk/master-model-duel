import type { OrderPaymentStatus, OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Bounded admin order queries (R-052, R-105, G-024): every list read has a
// hard take/skip ceiling and a deterministic sort (createdAt desc, id desc)
// so paging through 1k+ orders never scans unbounded or shuffles between
// requests.

export const ORDERS_PAGE_SIZE = 25;
const MAX_PAGE = 400;

export type OrderListFilters = {
  q: string;
  status: OrderStatus | null;
  payment: OrderPaymentStatus | null;
  page: number;
};

export function parseOrderListFilters(params: {
  q?: string;
  status?: string;
  payment?: string;
  page?: string;
}): OrderListFilters {
  const statuses: OrderStatus[] = ["DRAFT", "FINALIZED", "DISCARDED"];
  const payments: OrderPaymentStatus[] = ["UNPAID", "PARTIAL", "PAID", "COMPED"];
  const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));
  return {
    q: (params.q ?? "").trim().slice(0, 100),
    status: statuses.find((value) => value === params.status) ?? null,
    payment: payments.find((value) => value === params.payment) ?? null,
    page,
  };
}

function whereFor(filters: OrderListFilters): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.payment) where.paymentStatus = filters.payment;
  if (filters.q) {
    const asNumber = Number.parseInt(filters.q, 10);
    if (Number.isInteger(asNumber) && `${asNumber}` === filters.q) {
      // A pure number is an order-number lookup — fuzzy matching would bury
      // "#1" under a thousand references that merely contain the digit.
      where.orderNumber = asNumber;
    } else {
      where.OR = [
        { draftReference: { contains: filters.q, mode: "insensitive" as const } },
        { customer: { name: { contains: filters.q, mode: "insensitive" as const } } },
        { customer: { email: { contains: filters.q, mode: "insensitive" as const } } },
      ];
    }
  }
  return where;
}

export async function listOrders(filters: OrderListFilters) {
  const where = whereFor(filters);
  const [total, orders] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({
      where,
      include: { customer: { select: { id: true, name: true, email: true } }, _count: { select: { lines: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * ORDERS_PAGE_SIZE,
      take: ORDERS_PAGE_SIZE,
    }),
  ]);
  return { total, orders, pageCount: Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE)) };
}
