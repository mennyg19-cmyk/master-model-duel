import Link from "next/link";
import { db } from "@/lib/db";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { getOpenSeason } from "@/lib/season";
import { cartSchema } from "@/lib/order-builder/cart";
import { findActiveDraft } from "@/lib/order-builder/draft-store";
import { formatCents } from "@/lib/catalog";
import { Card, CardTitle } from "@/components/ui/card";
import { DraftActions, SignOutButton } from "@/components/account/draft-actions";

export default async function AccountDashboardPage() {
  const customer = (await getCustomerContext())!;
  const season = await getOpenSeason();

  const [activeDraft, recentOrders, addressCount] = await Promise.all([
    season ? findActiveDraft(season.id, { kind: "customer", customerId: customer.id }) : null,
    db.order.findMany({
      where: { customerId: customer.id, status: { not: "DISCARDED" } },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { season: true },
    }),
    db.customerAddress.count({ where: { customerId: customer.id } }),
  ]);

  const draftCart = activeDraft ? cartSchema.parse(activeDraft.cart) : null;
  const draftItemCount = draftCart?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Hi, {customer.name.split(" ")[0]}</h1>
          <p className="text-sm text-muted">{customer.email}</p>
        </div>
        <SignOutButton />
      </div>

      {draftCart && (
        <Card data-testid="active-draft-card">
          <CardTitle>Order in progress</CardTitle>
          <p className="mb-3 text-sm text-muted">
            {draftItemCount} {draftItemCount === 1 ? "item" : "items"} in your {season?.name} draft.
          </p>
          <DraftActions hasUnassignedLines={draftCart.lines.some((line) => !line.assignment)} />
        </Card>
      )}

      <Card>
        <CardTitle>Recent orders</CardTitle>
        {recentOrders.length === 0 ? (
          <p className="text-sm text-muted">No orders yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {recentOrders.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-2">
                <Link href={`/account/orders/${order.id}`} className="text-brand hover:underline">
                  {order.orderNumber ? `#${order.orderNumber}` : order.draftReference} — {order.season.name}
                </Link>
                <span className="text-muted">{formatCents(order.totalCents)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/account/orders" className="mt-3 inline-block text-sm text-brand hover:underline">
          All orders →
        </Link>
      </Card>

      <Card>
        <CardTitle>Address book</CardTitle>
        <p className="text-sm text-muted">
          {addressCount} saved {addressCount === 1 ? "recipient" : "recipients"}.
        </p>
        <Link href="/account/addresses" className="mt-3 inline-block text-sm text-brand hover:underline">
          Manage addresses →
        </Link>
      </Card>
    </div>
  );
}
