import type { Metadata } from "next";
import Link from "next/link";
import { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { requireCustomer } from "@/lib/customers/session";

export const metadata: Metadata = { title: "Your orders" };
export const dynamic = "force-dynamic";

// Explicit status priority — drafts (resumable) first, placed orders after.
// The Record forces a compile error if OrderStatus ever grows a new value.
const STATUS_SORT_PRIORITY: Record<OrderStatus, number> = { DRAFT: 0, FINALIZED: 1, DISCARDED: 2 };

// R-039: order history — drafts (resumable) and completed orders, newest
// first, scoped to the session customer.
export default async function OrdersPage() {
  const ctx = await requireCustomer();

  const orders = await prisma.order.findMany({
    where: { customerId: ctx.customer.id, status: { not: "DISCARDED" } },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { lines: true } } },
  });
  orders.sort((a, b) => STATUS_SORT_PRIORITY[a.status] - STATUS_SORT_PRIORITY[b.status]);

  return (
    <div data-account-orders>
      <h2 className="text-lg font-semibold text-stone-900">Order history</h2>
      {orders.length === 0 ? (
        <p className="mt-3 text-sm text-stone-600">
          Nothing here yet.{" "}
          <Link href="/order" className="text-brand-700 underline">
            Start an order
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 px-4 py-3"
              data-order-row={order.wireFormat ?? order.draftRef}
            >
              <div className="text-sm">
                <Link href={`/account/orders/${order.id}`} className="font-medium text-brand-700 hover:underline">
                  {order.wireFormat ?? order.draftRef}
                </Link>
                <span className="text-stone-500">
                  {" "}
                  · {order._count.lines} {order._count.lines === 1 ? "item" : "items"} · {formatCents(order.totalCents)}
                </span>
              </div>
              <span
                className={
                  order.status === "DRAFT"
                    ? "rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
                    : "rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800"
                }
              >
                {order.status === "DRAFT" ? "Draft" : "Placed"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
