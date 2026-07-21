import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { getOpenSeason } from "@/lib/season";
import { formatCents } from "@/lib/catalog";
import { wireFormat } from "@/lib/domain/draft-reference";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";

// Order detail (R-039). Ownership: a wrong or foreign id 404s identically, so
// order ids can't be probed (R-121).
export default async function AccountOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const customer = (await getCustomerContext())!;
  const { id } = await params;

  const order = await db.order.findUnique({
    where: { id },
    include: {
      season: true,
      lines: { include: { product: true, options: true, addOns: { include: { addOn: true } } } },
    },
  });
  if (!order || order.customerId !== customer.id || order.status === "DISCARDED") notFound();

  const openSeason = order.status === "FINALIZED" ? await getOpenSeason() : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/account/orders" className="text-sm text-brand hover:underline">
          ← All orders
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">
          {order.orderNumber ? `Order #${order.orderNumber}` : `Draft ${order.draftReference}`}
        </h1>
        <p className="text-sm text-muted">
          {order.season.name} · placed {order.createdAt.toLocaleDateString()} ·{" "}
          <Badge tone={order.paymentStatus === "PAID" ? "success" : "neutral"}>
            {order.paymentStatus.toLowerCase()}
          </Badge>
        </p>
        {order.status === "DRAFT" && (
          <p className="mt-2 text-sm text-muted">
            Paying by bank transfer? Use the reference <strong>{wireFormat(order.draftReference)}</strong>.
          </p>
        )}
        {openSeason && (
          <Link
            href={`/account/orders/${order.id}/repeat`}
            className="mt-2 inline-block rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong"
            data-testid="repeat-order-button"
          >
            Repeat this order
          </Link>
        )}
      </div>

      <Card>
        <CardTitle>Packages</CardTitle>
        <ul className="flex flex-col gap-3">
          {order.lines.map((line) => (
            <li key={line.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">
                  {line.product.name}
                  {line.quantity > 1 && ` ×${line.quantity}`}
                </p>
                <p className="font-semibold text-brand-strong">
                  {formatCents(
                    (line.unitPriceCents +
                      line.addOns.reduce((sum, addOn) => sum + addOn.unitPriceCents * addOn.quantity, 0)) *
                      line.quantity
                  )}
                </p>
              </div>
              {line.addOns.length > 0 && (
                <p className="text-xs text-muted">
                  + {line.addOns.map((addOn) => addOn.addOn.name).join(", ")}
                </p>
              )}
              <p className="mt-1 text-xs text-muted">
                To {line.recipientName}, {line.addressLine1}
                {line.addressLine2 ? `, ${line.addressLine2}` : ""}, {line.city}, {line.state} {line.zip}
              </p>
              {line.greeting && <p className="mt-1 text-xs italic text-muted">“{line.greeting}”</p>}
            </li>
          ))}
        </ul>
        <p className="mt-4 flex items-center justify-between border-t border-border pt-3 font-semibold">
          <span>Total</span>
          <span>{formatCents(order.totalCents)}</span>
        </p>
      </Card>
    </div>
  );
}
