import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

const PAGE_SIZE = 25;

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requirePermission("admin:view");
  const query = await searchParams;
  const page = Math.max(1, Number(query.page) || 1);
  const search = query.q?.trim();
  const where = search
    ? {
        OR: [
          { displayName: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};
  const [customers, total] = await Promise.all([
    db.customer.findMany({
      where,
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { orders: true, addresses: true } } },
    }),
    db.customer.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">Relationships</p>
      <h1 className="mt-2 text-4xl font-black">Customers</h1>
      <form className="mt-7 flex gap-3 rounded-2xl border border-[var(--border)] bg-white p-4">
        <input className="min-w-0 flex-1 rounded-xl border border-[var(--border)] px-4 py-3" defaultValue={query.q} name="q" placeholder="Name, email, or phone" />
        <button className="rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white">Search</button>
      </form>
      <div className="mt-5 divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-white">
        {customers.map((customer) => (
          <Link className="grid gap-2 p-5 sm:grid-cols-[1fr_auto] sm:items-center" href={`/admin/customers/${customer.id}`} key={customer.id}>
            <div><p className="font-bold">{customer.displayName}</p><p className="text-sm text-[var(--muted)]">{customer.email ?? customer.phone ?? "No contact"}</p></div>
            <p className="text-sm font-semibold">{customer._count.orders} orders · {customer._count.addresses} addresses</p>
          </Link>
        ))}
      </div>
      <nav className="mt-5 flex justify-between text-sm font-bold">
        {page > 1 ? <Link href={`?q=${encodeURIComponent(query.q ?? "")}&page=${page - 1}`}>← Previous</Link> : <span />}
        <span>Page {page} of {pages}</span>
        {page < pages ? <Link href={`?q=${encodeURIComponent(query.q ?? "")}&page=${page + 1}`}>Next →</Link> : <span />}
      </nav>
    </div>
  );
}
