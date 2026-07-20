import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requirePermission } from "@/lib/auth";
import { formatCurrency } from "@/lib/currency";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  await requirePermission("admin:view");
  const { customerId } = await params;
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      addresses: { orderBy: [{ label: "asc" }, { recipientName: "asc" }] },
      orders: {
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { _count: { select: { lines: true } } },
      },
    },
  });
  if (!customer) notFound();
  return (
    <div>
      <BackLink fallback="/admin/customers" />
      <h1 className="mt-4 text-4xl font-black">{customer.displayName}</h1>
      <p className="mt-2 text-[var(--muted)]">{customer.email ?? "No email"} · {customer.phone ?? "No phone"}</p>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-xl font-bold">Address book</h2>
          <div className="mt-4 divide-y divide-[var(--border)]">
            {customer.addresses.map((address) => <div className="py-3" key={address.id}><p className="font-bold">{address.label ?? address.recipientName}</p><p className="text-sm text-[var(--muted)]">{address.line1}, {address.city}, {address.region} {address.postalCode}</p></div>)}
            {!customer.addresses.length && <p className="py-4 text-[var(--muted)]">No saved addresses.</p>}
          </div>
        </section>
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-xl font-bold">Order history</h2>
          <div className="mt-4 divide-y divide-[var(--border)]">
            {customer.orders.map((order) => (
              <Link className="flex justify-between gap-4 py-3" href={`/admin/orders/${order.id}`} key={order.id}>
                <span><span className="font-bold">#{order.orderNumber ?? order.draftReference}</span><span className="ml-2 text-sm text-[var(--muted)]">{order._count.lines} gifts · {order.cachedPaymentStatus}</span></span>
                <span className="font-semibold">{formatCurrency(order.totalCents)}</span>
              </Link>
            ))}
            {!customer.orders.length && <p className="py-4 text-[var(--muted)]">No orders.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
