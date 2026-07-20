import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { normalizePhone } from "@/lib/customers";
import { Card } from "@/components/ui/card";

const PAGE_SIZE = 25;
const MAX_PAGE = 400;

/** Customer directory (R-062): bounded search + pagination over the full base. */
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requirePermissionPage("customers.manage");
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 100);
  const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1));

  const phoneDigits = normalizePhone(q);
  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          ...(phoneDigits && phoneDigits.length >= 4 ? [{ phoneNormalized: { contains: phoneDigits } }] : []),
        ],
      }
    : {};

  const [total, customers] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      include: { _count: { select: { orders: true, addresses: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageLink = (target: number) =>
    `/admin/customers?${new URLSearchParams({ ...(q ? { q } : {}), ...(target > 1 ? { page: `${target}` } : {}) })}`;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <p className="text-sm text-muted">
          {total} customer{total === 1 ? "" : "s"} · page {page} of {pageCount}
        </p>
      </div>

      <form method="GET" action="/admin/customers" className="mb-4 flex items-end gap-2">
        <label className="flex flex-col text-xs text-muted">
          Search
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Name, email, or phone"
            className="mt-1 w-72 rounded-md border border-border bg-white px-3 py-1.5 text-sm text-ink"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong"
        >
          Search
        </button>
        {q && (
          <Link href="/admin/customers" className="px-2 py-1.5 text-sm text-brand hover:underline">
            Clear
          </Link>
        )}
      </form>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Email</th>
              <th className="py-2 pr-3">Phone</th>
              <th className="py-2 pr-3">Orders</th>
              <th className="py-2">Addresses</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <Link href={`/admin/customers/${customer.id}`} className="font-medium text-brand hover:underline">
                    {customer.name}
                  </Link>
                </td>
                <td className="py-2 pr-3">{customer.email}</td>
                <td className="py-2 pr-3">{customer.phone ?? "—"}</td>
                <td className="py-2 pr-3">{customer._count.orders}</td>
                <td className="py-2">{customer._count.addresses}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-muted">
                  No customers match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {pageCount > 1 && (
        <div className="mt-4 flex gap-3 text-sm">
          {page > 1 && (
            <Link href={pageLink(page - 1)} className="text-brand hover:underline">
              ← Previous
            </Link>
          )}
          {page < pageCount && (
            <Link href={pageLink(page + 1)} className="text-brand hover:underline">
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
