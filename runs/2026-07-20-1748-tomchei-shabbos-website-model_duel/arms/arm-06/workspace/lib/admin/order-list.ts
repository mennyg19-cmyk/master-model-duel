import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";

// R-052/R-105: shared list controls state. The URL is the source of truth —
// filters survive pagination and are shareable by link. Queries stay bounded
// (take/skip) regardless of table size (G-024).
export const LIST_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export interface OrderListParams {
  q: string | null;
  status: OrderStatus | null;
  payment: PaymentStatus | null;
  page: number;
  pageSize: number;
}

type RawParams = Record<string, string | string[] | undefined>;

export function first(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, page), pageCount(total, pageSize));
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function parsePageSize(raw: string | string[] | undefined): number {
  const parsed = Number(first(raw));
  return (LIST_PAGE_SIZES as readonly number[]).includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
}

// One href builder for the list pages: active filters and a non-default page
// size survive pagination, page 1 and the default size stay out of the URL.
export function buildListHref(
  base: string,
  filters: Record<string, string | null>,
  pageSize: number,
  target: number,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  if (pageSize !== DEFAULT_PAGE_SIZE) query.set("size", String(pageSize));
  if (target > 1) query.set("page", String(target));
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}

export function parseOrderListParams(searchParams: RawParams): OrderListParams {
  const statusRaw = first(searchParams.status);
  const paymentRaw = first(searchParams.payment);
  return {
    q: first(searchParams.q),
    status: statusRaw && statusRaw in OrderStatus ? (statusRaw as OrderStatus) : null,
    payment: paymentRaw && paymentRaw in PaymentStatus ? (paymentRaw as PaymentStatus) : null,
    page: Math.max(1, Number(first(searchParams.page)) || 1),
    pageSize: parsePageSize(searchParams.size),
  };
}

// Search hits the order number (numeric paste), wire format ("MM-2026-0042"),
// draft ref, or the customer name/email — case-insensitive contains.
export function buildOrderWhere(seasonId: string, params: OrderListParams): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { seasonId };
  if (params.status) where.status = params.status;
  if (params.payment) where.paymentStatus = params.payment;
  if (params.q) {
    const numeric = /^\d+$/.test(params.q) ? Number(params.q) : null;
    where.OR = [
      { wireFormat: { contains: params.q, mode: "insensitive" } },
      { draftRef: { contains: params.q, mode: "insensitive" } },
      { customer: { name: { contains: params.q, mode: "insensitive" } } },
      { customer: { email: { contains: params.q, mode: "insensitive" } } },
      ...(numeric === null ? [] : [{ orderNumber: numeric }]),
    ];
  }
  return where;
}
