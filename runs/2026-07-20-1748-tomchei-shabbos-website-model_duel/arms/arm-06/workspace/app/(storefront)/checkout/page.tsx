import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getOpenSeason } from "@/lib/seasons/queries";
import { getSetting } from "@/lib/settings";
import { formatCents } from "@/lib/money";
import { loadOrderForCheckout } from "@/lib/orders/drafts";
import { checkoutAccess } from "@/lib/checkout/access";
import { ClosedNotice } from "@/components/storefront/closed-notice";
import { ClearGuestDraftOnSuccess } from "@/components/storefront/clear-guest-draft";
import { ZipCheckForm } from "@/app/(storefront)/checkout/zip-check-form";
import { CheckoutForm } from "@/app/(storefront)/checkout/checkout-form";

export const metadata: Metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

// P5 checkout: per-recipient fulfillment (UR-009), greeting default +
// overrides (UR-013), stale-total conflict UI (R-034/R-037), hosted Stripe
// handoff (R-166). Ownership stays session-or-guest-cookie; a miss renders
// "not found", never a hint (R-121).
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; paid?: string }>;
}) {
  const openSeason = await getOpenSeason();
  if (!openSeason) {
    return <ClosedNotice attempted="Checkout" />;
  }

  const { ref, paid } = await searchParams;
  const deliveryZips = (await getSetting("shipping.deliveryZips")) ?? [];

  if (!ref) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-2xl font-bold text-stone-900">Checkout</h1>
        <p className="mt-4 text-stone-600">
          Open a draft from the order builder to check out. You can already check whether an address
          is inside this season&apos;s delivery area.
        </p>
        <ZipCheckForm />
        <p className="mt-3 text-xs text-stone-500">
          Delivering to {deliveryZips.length} ZIP code{deliveryZips.length === 1 ? "" : "s"} this
          season.
        </p>
      </main>
    );
  }

  const order = await loadOrderForCheckout(ref, await checkoutAccess(ref));

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
    // Success state (R-035): the guest's local draft copy clears here and
    // only here.
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

  // Returned from hosted Stripe but the webhook hasn't landed yet.
  if (paid === "1" && order.stripeSessionId) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-2xl font-bold text-stone-900">Confirming your payment</h1>
        <p className="mt-4 text-stone-600" data-payment-processing>
          Stripe accepted the card and we&apos;re confirming the order — refresh in a few seconds.
          If it hasn&apos;t updated after a minute, contact us and mention {order.draftRef}.
        </p>
      </main>
    );
  }

  const [fees, deliveryDays] = await Promise.all([getSetting("delivery.fees"), getSetting("delivery.days")]);
  const remembered = await prisma.address.findMany({
    where: { id: { in: order.recipients.map((recipient) => recipient.addressId).filter((id): id is string => !!id) } },
    select: { id: true, lastGreeting: true },
  });
  const rememberedGreetings = new Map(remembered.map((row) => [row.id, row.lastGreeting]));

  const productLines = order.lines.filter((line) => line.productId !== null);
  const addOnLines = order.lines.filter((line) => line.addOnId !== null);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <ClearGuestDraftOnSuccess shouldClear={false} />
      <h1 className="text-2xl font-bold text-stone-900">Review your order</h1>
      <p className="mt-2 text-sm text-stone-500">Draft {order.draftRef}</p>

      <CheckoutForm
        draftRef={order.draftRef!}
        greetingDefault={order.greetingDefault}
        subtotalCents={order.lines.reduce((sum, line) => sum + line.lineTotalCents, 0)}
        feeRules={
          fees ?? { bulkPerDestinationCents: 0, perPackagePerRecipientCents: 0 }
        }
        deliveryDays={deliveryDays ?? []}
        deliveryZips={deliveryZips}
        recipients={order.recipients.map((recipient) => ({
          id: recipient.id,
          name: recipient.name,
          addressLine: `${recipient.line1}${recipient.line2 ? `, ${recipient.line2}` : ""}, ${recipient.city}, ${recipient.region} ${recipient.postalCode}`,
          line1: recipient.line1,
          city: recipient.city,
          region: recipient.region,
          postalCode: recipient.postalCode,
          country: recipient.country,
          rememberedGreeting: recipient.addressId ? rememberedGreetings.get(recipient.addressId) ?? null : null,
          initialChoice: recipient.fulfillmentChoice,
          initialDeliveryDay: recipient.deliveryDay,
          initialGreeting: recipient.greeting,
          lines: productLines
            .filter((line) => line.recipientId === recipient.id)
            .map((line) => ({
              id: line.id,
              label: `${line.qty} × ${line.productName}${line.optionLabel ? ` (${line.optionLabel})` : ""}`,
              addOns: addOnLines
                .filter((addOn) => addOn.parentLineId === line.id)
                .map((addOn) => `${addOn.qty} × ${addOn.productName}`),
              lineTotalCents:
                line.lineTotalCents +
                addOnLines
                  .filter((addOn) => addOn.parentLineId === line.id)
                  .reduce((sum, addOn) => sum + addOn.lineTotalCents, 0),
            })),
        }))}
        unassignedCount={productLines.filter((line) => !line.recipientId).length}
      />
    </main>
  );
}
