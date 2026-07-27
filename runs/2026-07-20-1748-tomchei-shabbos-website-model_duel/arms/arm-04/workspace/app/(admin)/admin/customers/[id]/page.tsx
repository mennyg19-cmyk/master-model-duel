import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { formatCents } from "@/lib/catalog";
import { Card, CardTitle } from "@/components/ui/card";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/order-badges";

const ORDER_HISTORY_LIMIT = 50;

/** Customer detail: profile, address book, and order history (R-062, R-064). */
export default async function AdminCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermissionPage("customers.manage");
  const { id } = await params;

  const customer = await db.customer.findUnique({
    where: { id },
    include: { addresses: { orderBy: { updatedAt: "desc" } } },
  });
  if (!customer) notFound();

  const orders = await db.order.findMany({
    where: { customerId: id },
    include: { season: { select: { name: true } }, _count: { select: { lines: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: ORDER_HISTORY_LIMIT,
  });

  return (
    <div>
      <Link href="/admin/customers" className="text-sm text-brand hover:underline">
        ← Back to customers
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold">{customer.name}</h1>
      <p className="mb-4 text-sm text-muted">
        {customer.email}
        {customer.phone ? ` · ${customer.phone}` : ""} · since {customer.createdAt.toISOString().slice(0, 10)}
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardTitle className="mb-3">Order history</CardTitle>
            {orders.length === 0 ? (
              <p className="text-sm text-muted">No orders yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="py-1.5 pr-3">Order</th>
                    <th className="py-1.5 pr-3">Season</th>
                    <th className="py-1.5 pr-3">Placed</th>
                    <th className="py-1.5 pr-3">Lines</th>
                    <th className="py-1.5 pr-3">Total</th>
                    <th className="py-1.5 pr-3">Status</th>
                    <th className="py-1.5">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3">
                        <Link href={`/admin/orders/${order.id}`} className="text-brand hover:underline">
                          {order.orderNumber ? `#${order.orderNumber}` : order.draftReference}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{order.season.name}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{order.createdAt.toISOString().slice(0, 10)}</td>
                      <td className="py-2 pr-3">{order._count.lines}</td>
                      <td className="py-2 pr-3">{formatCents(order.totalCents)}</td>
                      <td className="py-2 pr-3">
                        <OrderStatusBadge status={order.status} />
                      </td>
                      <td className="py-2">
                        <PaymentStatusBadge status={order.paymentStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div>
          <Card>
            <CardTitle className="mb-3">Address book</CardTitle>
            {customer.addresses.length === 0 ? (
              <p className="text-sm text-muted">No saved addresses.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {customer.addresses.map((address) => (
                  <li key={address.id} className="border-b border-border pb-2 last:border-0 last:pb-0">
                    <p className="font-medium">
                      {address.recipient}
                      {address.label && <span className="ml-1 text-xs text-muted">({address.label})</span>}
                    </p>
                    <p className="text-muted">
                      {address.line1}
                      {address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.state} {address.zip}
                    </p>
                    {address.lastGreeting && (
                      <p className="text-xs italic text-muted">Last greeting: “{address.lastGreeting}”</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
