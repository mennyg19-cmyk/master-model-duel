import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveCustomerId } from "@/lib/orders/draft-access";
import { formatCents } from "@/lib/storefront/catalog-shared";
import { lineSubtotalCents } from "@/lib/orders/totals";

type Props = { params: Promise<{ id: string }> };

export default async function AccountOrderDetailPage({ params }: Props) {
  const { id } = await params;
  const customerId = await resolveCustomerId();
  if (!customerId) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <p>Sign in required</p>
      </main>
    );
  }

  const order = await db.order.findFirst({
    where: { id, customerId },
    include: {
      lines: { include: { product: true, addOns: true } },
      season: true,
    },
  });
  if (!order) notFound();

  // Ownership already enforced by customerId filter (R-042).
  void AuthError;

  const canRepeat = order.status !== "DRAFT" && order.status !== "DISCARDED";

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10" data-testid="order-detail">
      <Link href="/account" className="text-sm font-semibold">
        ← Account
      </Link>
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
        Order #{order.orderNumber ?? order.draftRef}
      </h1>
      <p className="text-sm text-[var(--color-ink)]/70">
        {order.season.name} · {order.status}
      </p>
      {canRepeat ? (
        <Link
          href={`/account/orders/${order.id}/repeat`}
          className="inline-block rounded bg-[var(--color-leaf)] px-4 py-2 text-sm font-semibold text-white"
          data-testid="repeat-order-link"
        >
          Repeat this order
        </Link>
      ) : null}
      <ul className="space-y-2">
        {order.lines.map((line) => (
          <li key={line.id} className="rounded border bg-white p-3 text-sm">
            <p className="font-semibold">
              {line.product.name} × {line.quantity}
            </p>
            <p>
              {line.recipientName} — {line.addressLine1}, {line.city}
            </p>
            <p>{formatCents(lineSubtotalCents(line))}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
