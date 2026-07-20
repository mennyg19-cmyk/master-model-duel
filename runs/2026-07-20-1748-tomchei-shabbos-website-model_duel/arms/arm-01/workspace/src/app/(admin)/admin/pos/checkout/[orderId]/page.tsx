import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { PosCheckoutForm } from "@/components/pos-checkout-form";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PosCheckoutPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requirePermission("payments:manage");
  const { orderId } = await params;
  const order = await db.order.findFirst({
    where: { id: orderId, status: "DRAFT" },
    include: {
      customer: true,
      season: {
        include: {
          fulfillmentMethods: {
            where: { isActive: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      },
      lines: {
        include: { recipientAddress: true },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!order || order.lines.some((line) => !line.recipientAddress)) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <BackLink fallback="/admin/pos" />
      <p className="mt-5 text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">POS checkout</p>
      <h1 className="mt-2 text-4xl font-black">{order.customer.displayName}</h1>
      <p className="mt-2 text-[var(--muted)]">Confirm fulfillment and record the in-person payment.</p>
      <div className="mt-7 rounded-3xl border border-[var(--border)] bg-white p-6">
        <PosCheckoutForm
          fulfillmentMethods={order.season.fulfillmentMethods.map((method) => ({
            code: method.code,
            displayName: method.displayName,
          }))}
          lines={order.lines.map((line) => ({
            id: line.id,
            productName: line.productNameSnapshot,
            recipientName: line.recipientAddress!.recipientName,
            rememberedGreeting: line.recipientAddress!.rememberedGreeting ?? "",
          }))}
          orderId={order.id}
          subtotalCents={order.subtotalCents}
        />
      </div>
    </div>
  );
}
