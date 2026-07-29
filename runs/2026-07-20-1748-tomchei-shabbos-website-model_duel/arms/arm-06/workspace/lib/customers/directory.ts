import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeWhitespace } from "@/lib/text";
import { first, parsePageSize } from "@/lib/admin/order-list";

// R-062: customer directory list state — same URL-as-truth discipline as the
// order list (R-105 shared controls).
export interface CustomerListParams {
  q: string | null;
  page: number;
  pageSize: number;
}

export function parseCustomerListParams(
  searchParams: Record<string, string | string[] | undefined>,
): CustomerListParams {
  return {
    q: first(searchParams.q),
    page: Math.max(1, Number(first(searchParams.page)) || 1),
    pageSize: parsePageSize(searchParams.size),
  };
}

export function buildCustomerWhere(q: string | null): Prisma.CustomerWhereInput {
  if (!q) return {};
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
    ],
  };
}

// R-060: POS customer lookup — bounded top matches, never a table scan to the
// client. `take` is hard-capped so a crafted query param can't widen it.
export async function searchCustomers(q: string, take = 10) {
  const query = normalizeWhitespace(q);
  if (!query) return [];
  return prisma.customer.findMany({
    where: buildCustomerWhere(query),
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: Math.min(Math.max(1, take), 25),
    select: { id: true, name: true, email: true, phone: true },
  });
}
