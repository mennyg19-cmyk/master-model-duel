import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { requireCustomer } from "@/lib/customers/session";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

// R-038: account dashboard — open drafts with a continue path, recent orders,
// and the address-book count. Data is scoped to the session customer only.
export default async function AccountPage() {
  const ctx = await requireCustomer();

  const [drafts, recentOrders, addressCount] = await Promise.all([
    prisma.order.findMany({
      where: { customerId: ctx.customer.id, status: "DRAFT" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: { _count: { select: { lines: true } } },
    }),
    prisma.order.findMany({
      where: { customerId: ctx.customer.id, status: "FINALIZED" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.address.count({ where: { customerId: ctx.customer.id } }),
  ]);

  return (
    <div className="flex flex-col gap-8" data-account-dashboard>
      <section>
        <h2 className="text-lg font-semibold text-stone-900">Welcome back, {ctx.customer.name}</h2>
        <p className="mt-1 text-sm text-stone-600">
          {addressCount} saved {addressCount === 1 ? "address" : "addresses"} in your book ·{" "}
          <Link href="/account/addresses" className="text-brand-700 underline">
            manage addresses
          </Link>
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-stone-900">Open drafts</h2>
        {drafts.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">
            No drafts in progress.{" "}
            <Link href="/order" className="text-brand-700 underline">
              Start an order
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {drafts.map((draft) => (
              <li
                key={draft.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 px-4 py-3"
                data-draft-row={draft.draftRef}
              >
                <div className="text-sm">
                  <span className="font-medium text-stone-900">{draft.draftRef}</span>
                  <span className="text-stone-500">
                    {" "}
                    · {draft._count.lines} {draft._count.lines === 1 ? "item" : "items"} ·{" "}
                    {formatCents(draft.totalCents)}
                  </span>
                </div>
                <div className="flex gap-2 text-sm">
                  <Link href={`/order?draft=${draft.draftRef}`} className="font-medium text-brand-700 hover:underline">
                    Continue
                  </Link>
                  <Link
                    href={`/account/orders/${draft.id}`}
                    className="text-stone-600 hover:underline"
                  >
                    Details
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">Recent orders</h2>
          <Link href="/account/orders" className="text-sm font-medium text-brand-700 hover:underline">
            All orders
          </Link>
        </div>
        {recentOrders.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">No completed orders yet this season.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {recentOrders.map((order) => (
              <li key={order.id} className="rounded-md border border-stone-200 px-4 py-3 text-sm">
                <Link href={`/account/orders/${order.id}`} className="font-medium text-brand-700 hover:underline">
                  {order.wireFormat ?? order.draftRef}
                </Link>
                <span className="text-stone-500"> · {formatCents(order.totalCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
