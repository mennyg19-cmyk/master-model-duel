import 'server-only';

import type { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';

import { pageInfo, type PageInfo, type PageRequest } from '../admin/list-query';
import { normalizeEmail } from '../core/normalize';
import { db } from '../db';
import type { StaffOrderRow } from './staff-orders';

/**
 * The order desk (R-052, R-105).
 *
 * One search box, two filters and a bounded page, because that is what the
 * office actually does: somebody rings up, gives a name or an order number, and
 * staff need the row in one query rather than a scroll through a season. Every
 * read here is indexed and capped — the same list has to answer on the morning
 * of Purim with a thousand orders behind it (G-024).
 */
export const ORDER_DESK_STATUSES = [
  'PLACED',
  'IN_FULFILLMENT',
  'COMPLETED',
  'CANCELLED',
  'DRAFT',
] as const;

export type OrderDeskStatus = (typeof ORDER_DESK_STATUSES)[number];

export const ORDER_DESK_PAYMENTS = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERPAID'] as const;

export type OrderDeskFilters = {
  /** A name, an email, an order number or a draft reference — staff do not sort those. */
  search: string;
  status: OrderDeskStatus | null;
  payment: PaymentStatus | null;
  seasonId: string | null;
};

export type OrderDeskPage = {
  rows: StaffOrderRow[];
  page: PageInfo;
};

export function readOrderDeskFilters(input: {
  q?: string;
  status?: string;
  payment?: string;
  season?: string;
}): OrderDeskFilters {
  return {
    search: (input.q ?? '').trim().slice(0, 120),
    status: pick(ORDER_DESK_STATUSES, input.status),
    payment: pick(ORDER_DESK_PAYMENTS, input.payment),
    seasonId: (input.season ?? '').trim() || null,
  };
}

export async function listOrderDesk(
  filters: OrderDeskFilters,
  request: PageRequest,
): Promise<OrderDeskPage> {
  const where = orderDeskWhere(filters);

  const [totalCount, rows] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({
      where,
      include: { customer: { select: { fullName: true } } },
      // Placed orders sort by when they were placed; the id breaks ties so two
      // orders taken in the same millisecond cannot swap places between pages
      // and hide a row from whoever is paging through.
      orderBy: [{ placedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      skip: request.skip,
      take: request.take,
    }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      draftReference: row.draftReference,
      customerName: row.customer?.fullName ?? 'Guest',
      status: row.status,
      paymentStatus: row.paymentStatus,
      totalCents: row.totalCents,
      amountPaidCents: row.amountPaidCents,
      placedAt: row.placedAt,
    })),
    page: pageInfo(request, totalCount),
  };
}

/**
 * Discarded carts are never on the desk: they are abandoned shopping, not
 * orders, and a hundred of them between two real rows is what makes a list
 * useless. Drafts are hidden by default for the same reason but can be asked
 * for, because "they say they ordered and I cannot find it" is usually a cart
 * nobody paid for.
 */
export function orderDeskWhere(
  filters: OrderDeskFilters,
  statusScope: Prisma.OrderWhereInput['status'] = filters.status ?? {
    notIn: ['DRAFT', 'DISCARDED'],
  },
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    status: statusScope,
    ...(filters.payment ? { paymentStatus: filters.payment } : {}),
    ...(filters.seasonId ? { seasonId: filters.seasonId } : {}),
  };

  if (filters.search === '') return where;

  const orderNumber = /^#?\d{1,9}$/.test(filters.search)
    ? Number(filters.search.replace('#', ''))
    : null;

  return {
    ...where,
    OR: [
      ...(orderNumber === null ? [] : [{ orderNumber }]),
      { draftReference: { equals: filters.search, mode: 'insensitive' as const } },
      { customer: { fullName: { contains: filters.search, mode: 'insensitive' as const } } },
      { customer: { normalizedEmail: { contains: normalizeEmail(filters.search) } } },
    ],
  };
}

/**
 * Status counts for the filter chips, from the same search and payment filter
 * the list is using — so the chip says how many rows clicking it would show.
 */
export async function countOrdersByStatus(
  filters: OrderDeskFilters,
): Promise<Record<OrderStatus, number>> {
  const grouped = await db.order.groupBy({
    by: ['status'],
    where: orderDeskWhere(filters, { not: 'DISCARDED' }),
    _count: { _all: true },
  });

  const counts = Object.fromEntries(
    ORDER_DESK_STATUSES.map((status) => [status, 0]),
  ) as Record<OrderStatus, number>;

  for (const row of grouped) counts[row.status] = row._count._all;
  return counts;
}

function pick<T extends string>(allowed: readonly T[], raw: string | undefined): T | null {
  const value = (raw ?? '').trim().toUpperCase();
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
