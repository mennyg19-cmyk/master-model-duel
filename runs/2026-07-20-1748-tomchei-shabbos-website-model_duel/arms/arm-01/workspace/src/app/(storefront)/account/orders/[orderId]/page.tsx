import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelDraftButton } from "@/components/account-actions";
import { formatCurrency } from "@/lib/currency";
import { getAuthenticatedCustomer } from "@/lib/customer-access";
import { db } from "@/lib/db";
import { getCurrentSeason } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function AccountOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const [{ orderId }, account] = await Promise.all([params, getAuthenticatedCustomer()]);
  if (!account?.customerId) notFound();
  const [order, currentSeason] = await Promise.all([
    db.order.findFirst({
      where: { id: orderId, customerId: account.customerId },
      include: {
        lines: {
          include: { addOns: true, recipientAddress: true, productOption: true },
        },
      },
    }),
    getCurrentSeason(),
  ]);
  if (!order) notFound();

  return (
    <div className="rounded-[2rem] border border-[var(--border)] bg-white p-7">
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
        {order.status}
      </p>
      <h1 className="mt-2 text-4xl font-black">
        {order.orderNumber ? `Order #${order.orderNumber}` : order.draftReference}
      </h1>
      <div className="mt-7 divide-y divide-[var(--border)]">
        {order.lines.map((line) => (
          <div className="py-4" key={line.id}>
            <div className="flex justify-between gap-4">
              <p className="font-bold">
                {line.quantity} × {line.productNameSnapshot}
              </p>
              <p className="font-bold">
                {formatCurrency(line.unitPriceCentsSnapshot * line.quantity)}
              </p>
            </div>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {line.recipientAddress
                ? `For ${line.recipientAddress.recipientName} at ${line.recipientAddress.line1}`
                : "Recipient not assigned"}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-between border-t border-[var(--border)] pt-5 text-xl font-black">
        <span>Total</span>
        <span>{formatCurrency(order.totalCents)}</span>
      </div>
      {order.status === "DRAFT" && (
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            className="rounded-full bg-[var(--brand)] px-5 py-2.5 font-bold text-white"
            href={`/order?draft=${order.id}`}
          >
            Continue and pay
          </Link>
          <CancelDraftButton
            draftId={order.id}
            storageOwnerKey={account.customerId}
          />
        </div>
      )}
      {order.status === "FINALIZED" &&
        order.seasonId !== currentSeason?.id &&
        currentSeason?.status === "OPEN" && (
        <Link
          className="mt-7 inline-block rounded-full bg-[var(--brand)] px-5 py-2.5 font-bold text-white"
          href={`/account/orders/${order.id}/repeat`}
        >
          Repeat for {currentSeason?.name ?? "current season"}
        </Link>
      )}
    </div>
  );
}
