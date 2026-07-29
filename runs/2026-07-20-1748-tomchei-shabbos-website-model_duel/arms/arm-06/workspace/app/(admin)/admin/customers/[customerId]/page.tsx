import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { Card, CardTitle } from "@/components/ui/card";
import { BackLink } from "@/components/admin/back-link";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/order-badges";
import { CustomerEditor } from "@/app/(admin)/admin/customers/[customerId]/customer-editor";
import { BookCleanup } from "@/app/(admin)/admin/customers/[customerId]/book-cleanup";
import { scanBook } from "@/lib/imports/legacy/cleanup";

export const metadata: Metadata = { title: "Customer detail" };
export const dynamic = "force-dynamic";

// R-064: customer detail — identity edit, address book, full order history.
// History is bounded to the newest 50 (a directory page, not a report).
export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  await requirePermission("customers.manage");
  const { customerId } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      addresses: { orderBy: [{ label: "asc" }, { createdAt: "asc" }] },
      orders: {
        where: { status: { not: "DISCARDED" } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        select: {
          id: true,
          wireFormat: true,
          draftRef: true,
          status: true,
          paymentStatus: true,
          totalCents: true,
          createdAt: true,
          season: { select: { name: true } },
        },
      },
    },
  });
  if (!customer) notFound();

  // UR-014: cleanup scan feeds the review card (renders only when there's
  // something to decide).
  const scan = await scanBook(customer.id);
  const toCleanupAddress = (address: (typeof customer.addresses)[number]) => ({
    id: address.id,
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    reviewReason: address.reviewReason,
  });

  const lifetimeCents = customer.orders
    .filter((order) => order.status === "FINALIZED")
    .reduce((sum, order) => sum + order.totalCents, 0);

  return (
    <div>
      <BackLink href="/admin/customers" label="All customers" />
      <h1 className="mt-3 text-2xl font-semibold" data-customer-heading>
        {customer.name}
      </h1>
      <p className="mt-1 text-sm text-stone-500">
        {customer.email}
        {customer.phone ? ` · ${customer.phone}` : ""} · customer since {customer.createdAt.toISOString().slice(0, 10)}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <CustomerEditor customer={{ id: customer.id, name: customer.name, email: customer.email, phone: customer.phone }} />

        <Card className="p-5">
          <CardTitle>Address book</CardTitle>
          <ul className="mt-3 flex flex-col gap-2 text-sm" data-address-book>
            {customer.addresses.map((address) => (
              <li key={address.id} className="rounded-md border border-stone-200 px-3 py-2">
                <span className="font-medium">{address.label ?? "Address"}</span>
                <span className="ml-2 text-stone-600">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.region} {address.postalCode}
                </span>
                {address.needsReview && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">needs review</span>
                )}
              </li>
            ))}
            {customer.addresses.length === 0 && <li className="text-stone-500">No saved addresses.</li>}
          </ul>
        </Card>
      </div>

      <BookCleanup
        customerId={customer.id}
        duplicates={scan.duplicates.map((group) => ({ key: group.key, addresses: group.addresses.map(toCleanupAddress) }))}
        flagged={scan.flagged.map(toCleanupAddress)}
      />

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Order history</h2>
          <span className="text-sm text-stone-500" data-lifetime-total>
            {formatCents(lifetimeCents)} lifetime finalized
          </span>
        </div>
        <table className="mt-3 w-full border-collapse text-sm" data-order-history>
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="py-2 pr-4">Order</th>
              <th className="py-2 pr-4">Season</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Payment</th>
              <th className="py-2 pr-4 text-right">Total</th>
              <th className="py-2">Placed</th>
            </tr>
          </thead>
          <tbody>
            {customer.orders.map((order) => (
              <tr key={order.id} className="border-b border-stone-100 hover:bg-stone-50">
                <td className="py-2 pr-4 font-medium">
                  <Link href={`/admin/orders/${order.id}`} className="text-brand-700 hover:underline">
                    {order.wireFormat ?? order.draftRef ?? order.id}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-stone-600">{order.season.name}</td>
                <td className="py-2 pr-4">
                  <OrderStatusBadge status={order.status} />
                </td>
                <td className="py-2 pr-4">
                  <PaymentStatusBadge status={order.paymentStatus} />
                </td>
                <td className="py-2 pr-4 text-right font-medium">{formatCents(order.totalCents)}</td>
                <td className="py-2 text-stone-600">{order.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
            {customer.orders.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-stone-500">
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
