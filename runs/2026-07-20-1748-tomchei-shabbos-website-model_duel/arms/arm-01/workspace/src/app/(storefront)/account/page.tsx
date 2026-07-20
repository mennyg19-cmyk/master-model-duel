import Link from "next/link";
import { getAuthenticatedCustomer } from "@/lib/customer-access";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/currency";

export const dynamic = "force-dynamic";

export default async function AccountDashboardPage() {
  const account = await getAuthenticatedCustomer();
  if (!account?.customerId || !account.customer) {
    return <AccountUnavailable />;
  }
  const orders = await db.order.findMany({
    where: { customerId: account.customerId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
        Customer account
      </p>
      <h1 className="mt-2 text-4xl font-black">Welcome, {account.customer.displayName}</h1>
      <div className="mt-7 grid gap-4 sm:grid-cols-3">
        <AccountStat label="Orders" value={orders.length.toString()} />
        <AccountStat
          label="Open drafts"
          value={orders.filter((order) => order.status === "DRAFT").length.toString()}
        />
        <AccountStat label="Address book" value="View saved recipients" />
      </div>
      <section className="mt-8 rounded-[2rem] border border-[var(--border)] bg-white p-6">
        <h2 className="text-2xl font-black">Order history</h2>
        <div className="mt-4 divide-y divide-[var(--border)]">
          {orders.map((order) => (
            <div className="flex flex-wrap items-center justify-between gap-4 py-4" key={order.id}>
              <div>
                <p className="font-bold">{order.orderNumber ? `Order #${order.orderNumber}` : order.draftReference}</p>
                <p className="text-sm text-[var(--muted)]">
                  {order.status} · {formatCurrency(order.totalCents)}
                </p>
              </div>
              <div className="flex gap-3">
                <Link className="font-bold text-[var(--brand)]" href={`/account/orders/${order.id}`}>
                  Details
                </Link>
                {order.status === "DRAFT" && (
                  <Link className="font-bold text-[var(--brand)]" href={`/order?draft=${order.id}`}>
                    Continue
                  </Link>
                )}
              </div>
            </div>
          ))}
          {orders.length === 0 && (
            <p className="py-10 text-center text-[var(--muted)]">No orders yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function AccountStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <p className="text-sm font-bold text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}

function AccountUnavailable() {
  return (
    <div className="rounded-[2rem] border border-[var(--border)] bg-white p-8">
      <h1 className="text-3xl font-black">Sign in to view your account</h1>
      <p className="mt-3 text-[var(--muted)]">
        Customer account data is never shown without a matching identity.
      </p>
      <Link className="mt-6 inline-block rounded-full bg-[var(--brand)] px-6 py-3 font-bold text-white" href="/order">
        Continue as guest
      </Link>
    </div>
  );
}
