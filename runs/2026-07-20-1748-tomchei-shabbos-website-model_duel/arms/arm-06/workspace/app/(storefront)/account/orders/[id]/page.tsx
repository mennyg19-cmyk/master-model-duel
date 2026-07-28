import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { requireCustomer } from "@/lib/customers/session";
import { CancelDraftButton } from "./cancel-draft-button";

export const metadata: Metadata = { title: "Order details" };
export const dynamic = "force-dynamic";

// R-039/R-040: order detail with the draft actions — continue (builder), pay
// (checkout handoff), cancel. Ownership: notFound() on any foreign id so the
// page can't be used to probe other customers' orders.
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCustomer();
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { createdAt: "asc" } },
      recipients: true,
      season: true,
    },
  });
  if (!order || order.customerId !== ctx.customer.id || order.status === "DISCARDED") notFound();
  // Every order this page renders came from the draft flow; a missing ref
  // means the row is not something this page can link back into.
  const draftRef = order.draftRef;
  if (!draftRef) notFound();

  const productLines = order.lines.filter((line) => line.productId !== null);

  return (
    <div data-order-detail={order.id}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">
            {order.wireFormat ?? order.draftRef}
          </h2>
          <p className="mt-0.5 text-sm text-stone-500">
            Season {order.season.name} ·{" "}
            {order.status === "DRAFT" ? "Draft — not placed yet" : "Placed"} ·{" "}
            {formatCents(order.totalCents)}
          </p>
        </div>
        {order.status === "DRAFT" && (
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/order?draft=${draftRef}`}
              className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
              data-continue-draft
            >
              Continue editing
            </Link>
            <Link
              href={`/checkout?ref=${draftRef}`}
              className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-900 hover:bg-stone-100"
              data-pay-draft
            >
              Go to checkout
            </Link>
            <CancelDraftButton draftRef={draftRef} />
          </div>
        )}
      </div>

      <ul className="mt-6 flex flex-col gap-4">
        {order.recipients.map((recipient) => {
          const lines = productLines.filter((line) => line.recipientId === recipient.id);
          return (
            <li key={recipient.id} className="rounded-lg border border-stone-200 p-4" data-recipient-group={recipient.name}>
              <h3 className="font-semibold text-stone-900">{recipient.name}</h3>
              <p className="text-sm text-stone-500">
                {recipient.line1}
                {recipient.line2 ? `, ${recipient.line2}` : ""}, {recipient.city}, {recipient.region}{" "}
                {recipient.postalCode}
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {lines.map((line) => (
                  <li key={line.id} className="flex justify-between text-sm text-stone-700">
                    <span>
                      {line.qty} × {line.productName}
                      {line.optionLabel ? ` (${line.optionLabel})` : ""}
                    </span>
                    <span>{formatCents(line.lineTotalCents)}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>

      {productLines.some((line) => !line.recipientId) && (
        <section className="mt-4 rounded-lg border border-stone-200 p-4">
          <h3 className="font-semibold text-stone-900">Not assigned yet</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {productLines
              .filter((line) => !line.recipientId)
              .map((line) => (
                <li key={line.id} className="flex justify-between text-sm text-stone-700">
                  <span>
                    {line.qty} × {line.productName}
                    {line.optionLabel ? ` (${line.optionLabel})` : ""}
                  </span>
                  <span>{formatCents(line.lineTotalCents)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <div className="mt-6 flex items-center justify-between border-t border-stone-200 pt-4 text-lg font-semibold text-stone-900">
        <span>Total</span>
        <span>{formatCents(order.totalCents)}</span>
      </div>
    </div>
  );
}
