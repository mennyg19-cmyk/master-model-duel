import Link from "next/link";
import { db } from "@/lib/db";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { getOpenSeason } from "@/lib/season";
import { cartSchema } from "@/lib/order-builder/cart";
import { formatCents } from "@/lib/catalog";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { DraftActions } from "@/components/account/draft-actions";

// Order history (R-039): every non-discarded order the customer owns, plus
// the in-progress builder draft on top.
export default async function AccountOrdersPage() {
  const customer = (await getCustomerContext())!;
  const season = await getOpenSeason();

  const [activeDraft, orders] = await Promise.all([
    season
      ? db.orderDraft.findFirst({
          where: { customerId: customer.id, seasonId: season.id, status: "ACTIVE" },
        })
      : null,
    db.order.findMany({
      where: { customerId: customer.id, status: { not: "DISCARDED" } },
      orderBy: { createdAt: "desc" },
      include: { season: true, lines: true },
    }),
  ]);
  const draftCart = activeDraft ? cartSchema.parse(activeDraft.cart) : null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">Your orders</h1>

      {draftCart && (
        <Card data-testid="draft-order-row">
          <CardTitle>Draft in progress</CardTitle>
          <p className="mb-3 text-sm text-muted">
            {draftCart.lines.reduce((sum, line) => sum + line.quantity, 0)} items — not placed yet.
          </p>
          <DraftActions hasUnassignedLines={draftCart.lines.some((line) => !line.assignment)} />
        </Card>
      )}

      {orders.length === 0 && !draftCart ? (
        <p className="text-sm text-muted">
          Nothing here yet. <Link href="/order" className="text-brand hover:underline">Start an order</Link>.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/account/orders/${order.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm hover:border-brand"
              >
                <div>
                  <p className="font-semibold">
                    {order.orderNumber ? `Order #${order.orderNumber}` : order.draftReference}
                    <span className="ml-2 text-sm font-normal text-muted">{order.season.name}</span>
                  </p>
                  <p className="text-sm text-muted">
                    {order.lines.length} {order.lines.length === 1 ? "package" : "packages"} ·{" "}
                    {order.createdAt.toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-brand-strong">{formatCents(order.totalCents)}</p>
                  <Badge tone={order.paymentStatus === "PAID" ? "success" : "neutral"}>
                    {order.paymentStatus.toLowerCase()}
                  </Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
