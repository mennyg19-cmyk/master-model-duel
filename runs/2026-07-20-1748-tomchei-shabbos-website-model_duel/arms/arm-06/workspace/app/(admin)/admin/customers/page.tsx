import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildCustomerWhere, parseCustomerListParams } from "@/lib/customers/directory";
import { buildListHref, clampPage, pageCount } from "@/lib/admin/order-list";
import { Input } from "@/components/ui/input";
import { PaginationNav } from "@/components/admin/pagination-nav";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

// R-062: customer directory — same URL-as-truth search + bounded pagination
// discipline as the order list (R-105 shared controls).
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("customers.manage");
  const params = parseCustomerListParams(await searchParams);

  const where = buildCustomerWhere(params.q);
  const total = await prisma.customer.count({ where });
  const page = clampPage(params.page, total, params.pageSize);
  const customers = await prisma.customer.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: params.pageSize,
    skip: (page - 1) * params.pageSize,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
      _count: { select: { orders: { where: { status: "FINALIZED" } } } },
    },
  });

  const pages = pageCount(total, params.pageSize);
  const pageHref = (target: number) => buildListHref("/admin/customers", { q: params.q }, params.pageSize, target);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Customers</h1>

      <form method="GET" action="/admin/customers" className="mt-4 flex items-end gap-3" data-customer-filters>
        <div>
          <label htmlFor="q" className="block text-xs font-medium text-stone-600">
            Search
          </label>
          <Input
            id="q"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Name, email, or phone…"
            className="mt-1 w-72"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Search
        </button>
      </form>

      <p className="mt-4 text-sm text-stone-500" data-customer-count>
        {total} customer{total === 1 ? "" : "s"}
      </p>

      <table className="mt-3 w-full border-collapse text-sm" data-customer-table>
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Email</th>
            <th className="py-2 pr-4">Phone</th>
            <th className="py-2 pr-4 text-right">Orders</th>
            <th className="py-2">Since</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((customer) => (
            <tr key={customer.id} className="border-b border-stone-100 hover:bg-stone-50">
              <td className="py-2 pr-4 font-medium">
                <Link href={`/admin/customers/${customer.id}`} className="text-brand-700 hover:underline">
                  {customer.name}
                </Link>
              </td>
              <td className="py-2 pr-4 text-stone-600">{customer.email}</td>
              <td className="py-2 pr-4 text-stone-600">{customer.phone ?? "—"}</td>
              <td className="py-2 pr-4 text-right">{customer._count.orders}</td>
              <td className="py-2 text-stone-600">{customer.createdAt.toISOString().slice(0, 10)}</td>
            </tr>
          ))}
          {customers.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-stone-500">
                No customers match.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <PaginationNav page={page} pages={pages} href={pageHref} />
    </div>
  );
}
