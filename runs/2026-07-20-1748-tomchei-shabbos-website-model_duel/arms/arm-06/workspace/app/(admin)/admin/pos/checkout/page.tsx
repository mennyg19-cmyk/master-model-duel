import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { loadOrderForCheckout } from "@/lib/orders/drafts";
import { buildCheckoutRecipients } from "@/lib/checkout/recipient-props";
import { quoteCheckoutShipping } from "@/lib/checkout/shipping-quotes";
import { BackLink } from "@/components/admin/back-link";
import { CheckoutForm } from "@/app/(storefront)/checkout/checkout-form";

export const metadata: Metadata = { title: "POS checkout" };
export const dynamic = "force-dynamic";

// R-061: counter checkout — the same per-recipient fulfillment form as the
// storefront, but completion posts cash/check with the staff audit row
// (UR-011). Staff access to the draft runs through the gated staff flag.
export default async function AdminPosCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  await requirePermission("payments.manage");
  const { ref } = await searchParams;

  if (!ref) {
    return (
      <div className="max-w-2xl">
        <BackLink href="/admin/pos" label="POS" />
        <p className="mt-6 text-sm text-stone-600">Open a cart from the POS to check out.</p>
      </div>
    );
  }

  const order = await loadOrderForCheckout(ref, { staff: true });
  if (!order || order.status === "DISCARDED") {
    return (
      <div className="max-w-2xl">
        <BackLink href="/admin/pos" label="POS" />
        <p className="mt-6 text-sm text-stone-600" data-pos-checkout-not-found>
          That order isn&apos;t available — it may have been discarded. Start a new one from the POS.
        </p>
      </div>
    );
  }

  if (order.status === "FINALIZED") {
    return (
      <div className="max-w-2xl">
        <BackLink href="/admin/pos" label="POS" />
        <h1 className="mt-4 text-2xl font-semibold" data-pos-success>
          Sale complete
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Order {order.wireFormat ?? order.draftRef} is finalized.{" "}
          <Link href={`/admin/orders/${order.id}`} className="font-medium text-brand-700 hover:underline">
            Open the order →
          </Link>
        </p>
      </div>
    );
  }

  const [fees, deliveryDays, deliveryZips, remembered, customer] = await Promise.all([
    getSetting("delivery.fees"),
    getSetting("delivery.days"),
    getSetting("shipping.deliveryZips"),
    prisma.address.findMany({
      where: {
        id: { in: order.recipients.map((recipient) => recipient.addressId).filter((id): id is string => !!id) },
      },
      select: { id: true, lastGreeting: true },
    }),
    prisma.customer.findUnique({ where: { id: order.customerId }, select: { name: true } }),
  ]);
  const { recipients, unassignedCount, subtotalCents } = buildCheckoutRecipients(
    order,
    new Map(remembered.map((row) => [row.id, row.lastGreeting])),
  );
  const shippingQuotes = await quoteCheckoutShipping({ orderId: order.id, recipients });

  return (
    <div className="max-w-3xl">
      <BackLink href="/admin/pos" label="POS" />
      <h1 className="mt-4 text-2xl font-semibold">Counter checkout</h1>
      <p className="mt-1 text-sm text-stone-500">
        Draft {order.draftRef} · {customer?.name ?? "customer"}
      </p>

      <CheckoutForm
        draftRef={order.draftRef!}
        greetingDefault={order.greetingDefault}
        subtotalCents={subtotalCents}
        feeRules={fees ?? { bulkPerDestinationCents: 0, perPackagePerRecipientCents: 0 }}
        deliveryDays={deliveryDays ?? []}
        deliveryZips={deliveryZips ?? []}
        recipients={recipients}
        unassignedCount={unassignedCount}
        shippingQuotes={shippingQuotes}
        builderHref={`/admin/pos`}
        pos={{ completeUrl: "/api/admin/pos/checkout", orderHref: (orderId) => `/admin/orders/${orderId}` }}
      />
    </div>
  );
}
