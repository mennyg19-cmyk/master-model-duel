import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/catalog";
import { GUEST_DRAFT_COOKIE } from "@/lib/order-builder/draft-store";
import { cookies } from "next/headers";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Post-payment landing. The webhook does the money/stock work; this page just
 * reports the result and drops the guest draft cookie once its draft really
 * completed (guest-clear-on-success — the webhook can't touch browser cookies).
 */
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  if (!ref) notFound();

  const order = await db.order.findUnique({ where: { draftReference: ref } });
  if (!order) notFound();

  const cookieStore = await cookies();
  const guestToken = cookieStore.get(GUEST_DRAFT_COOKIE)?.value;
  if (guestToken && order.sourceDraftId) {
    const tokenHash = createHmac("sha256", env.SESSION_SECRET)
      .update(`guest-draft:${guestToken}`)
      .digest("hex");
    const draft = await db.orderDraft.findUnique({ where: { id: order.sourceDraftId } });
    if (draft && draft.guestTokenHash === tokenHash && draft.status === "COMPLETED") {
      cookieStore.delete(GUEST_DRAFT_COOKIE);
    }
  }

  const paid = order.paymentStatus === "PAID" || order.paymentStatus === "COMPED";

  return (
    <main className="mx-auto max-w-xl px-4 py-12 text-center">
      {paid && order.status === "FINALIZED" ? (
        <>
          <h1 className="text-2xl font-bold">Thank you — your order is in!</h1>
          <p className="mt-3 text-sm text-muted">
            Order <span className="font-semibold" data-testid="order-number">#{order.orderNumber}</span> ·{" "}
            {formatCents(order.totalCents)} paid
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">Payment received — finishing up</h1>
          <p className="mt-3 text-sm text-muted">
            Reference {order.draftReference}. If this page still shows in a minute, refresh — we&apos;re
            confirming your payment with Stripe.
          </p>
        </>
      )}
      <div className="mt-6 flex justify-center gap-3 text-sm">
        <Link href="/account" className="font-medium text-brand hover:underline">
          View my orders
        </Link>
        <Link href="/" className="font-medium text-brand hover:underline">
          Back to the store
        </Link>
      </div>
    </main>
  );
}
