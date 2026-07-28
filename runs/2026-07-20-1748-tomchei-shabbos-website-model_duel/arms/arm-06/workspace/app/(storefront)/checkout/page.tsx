import type { Metadata } from "next";
import Link from "next/link";
import { getOpenSeason } from "@/lib/seasons/queries";
import { getSetting } from "@/lib/settings";
import { formatCents } from "@/lib/money";
import { getCustomerContext } from "@/lib/customers/session";
import { loadOrderForCheckout } from "@/lib/orders/drafts";
import { readGuestDraftToken } from "@/lib/orders/guest-draft-cookie";
import { ClosedNotice } from "@/components/storefront/closed-notice";
import { ClearGuestDraftOnSuccess } from "@/components/storefront/clear-guest-draft";
import { ZipCheckForm } from "@/app/(storefront)/checkout/zip-check-form";

export const metadata: Metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

// P4 checkout: the draft handoff. ?ref=<draftRef> shows the recipient/line
// summary with ownership enforced (session or the guest's httpOnly cookie —
// a miss renders "not found", never a hint). Payment capture, fulfillment
// methods, and Stripe arrive in P5; the delivery-ZIP probe stays.
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const openSeason = await getOpenSeason();
  if (!openSeason) {
    return <ClosedNotice attempted="Checkout" />;
  }

  const { ref } = await searchParams;
  const deliveryZips = (await getSetting("shipping.deliveryZips")) ?? [];

  if (!ref) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-2xl font-bold text-stone-900">Checkout</h1>
        <p className="mt-4 text-stone-600">
          Payment and fulfillment arrive with the checkout release. You can already check whether an
          address is inside this season&apos;s delivery area.
        </p>
        <ZipCheckForm />
        <p className="mt-3 text-xs text-stone-500">
          Delivering to {deliveryZips.length} ZIP code{deliveryZips.length === 1 ? "" : "s"} this
          season.
        </p>
      </main>
    );
  }

  const customerCtx = await getCustomerContext();
  const order = await loadOrderForCheckout(ref, {
    customerId: customerCtx?.customer.id,
    guestToken: await readGuestDraftToken(ref),
  });

  if (!order) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-2xl font-bold text-stone-900">Checkout</h1>
        <p className="mt-4 text-stone-600" data-checkout-not-found>
          We couldn&apos;t find that order. It may have expired — guest drafts open only in the
          browser that started the order.
        </p>
        <p className="mt-6">
          <Link href="/order" className="font-medium text-brand-700 underline">
            Start a new order
          </Link>
        </p>
      </main>
    );
  }

  const productLines = order.lines.filter((line) => line.productId !== null);

  if (order.status === "DISCARDED") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-2xl font-bold text-stone-900">Draft cancelled</h1>
        <p className="mt-4 text-stone-600">
          This draft was cancelled. Start fresh from the{" "}
          <Link href="/order" className="font-medium text-brand-700 underline">
            order builder
          </Link>
          .
        </p>
      </main>
    );
  }

  if (order.status === "FINALIZED") {
    // Success state: the guest's local draft copy clears here and only here.
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <ClearGuestDraftOnSuccess shouldClear />
        <h1 className="text-2xl font-bold text-stone-900">Order received</h1>
        <p className="mt-4 text-stone-600" data-order-finalized>
          Order {order.wireFormat ?? order.draftRef} is in. Total {formatCents(order.totalCents)}.
          We&apos;ll email your receipt and packing updates.
        </p>
      </main>
    );
  }

  // DRAFT: review summary. The clear marker renders OFF — refreshing checkout
  // must not wipe the guest's working draft (S2).
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <ClearGuestDraftOnSuccess shouldClear={false} />
      <h1 className="text-2xl font-bold text-stone-900">Review your order</h1>
      <p className="mt-2 text-sm text-stone-500">Draft {order.draftRef}</p>

      <ul className="mt-6 flex flex-col gap-4" data-checkout-summary>
        {order.recipients.map((recipient) => {
          const lines = productLines.filter((line) => line.recipientId === recipient.id);
          return (
            <li key={recipient.id} className="rounded-lg border border-stone-200 p-4" data-checkout-recipient={recipient.name}>
              <h2 className="font-semibold text-stone-900">{recipient.name}</h2>
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
        {productLines.some((line) => !line.recipientId) && (
          <li className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Some items aren&apos;t assigned to a recipient yet —{" "}
            <Link href={`/order?draft=${order.draftRef}`} className="underline">
              back to the builder
            </Link>
            .
          </li>
        )}
      </ul>

      <div className="mt-6 flex items-center justify-between border-t border-stone-200 pt-4 text-lg font-semibold text-stone-900">
        <span>Total</span>
        <span data-checkout-total>{formatCents(order.totalCents)}</span>
      </div>

      <p className="mt-6 rounded-md bg-stone-100 p-4 text-sm text-stone-600">
        Payment opens with the next release — your draft is saved and nothing is charged yet.
        Fulfillment method and delivery scheduling arrive with payment.
      </p>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-stone-900">Check delivery availability</h2>
        <ZipCheckForm />
        <p className="mt-2 text-xs text-stone-500">
          Delivering to {deliveryZips.length} ZIP code{deliveryZips.length === 1 ? "" : "s"} this season.
        </p>
      </div>
    </main>
  );
}
