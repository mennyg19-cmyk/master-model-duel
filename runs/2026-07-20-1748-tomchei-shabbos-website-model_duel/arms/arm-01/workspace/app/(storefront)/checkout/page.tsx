import Link from "next/link";
import { redirect } from "next/navigation";
import { getOpenSeason } from "@/lib/season";
import { getCustomerContext } from "@/lib/auth/customer-session";
import { parseCart, resolveDraftOwner, findActiveDraft } from "@/lib/order-builder/draft-store";
import { buildCheckoutQuote } from "@/lib/checkout/quote";
import { CheckoutForm } from "@/components/checkout/checkout-form";

/**
 * Checkout (P5): per-recipient fulfillment method, delivery fees, greetings,
 * donation, then hosted Stripe payment. All money math happens server-side —
 * this page only renders what the quote engine computed.
 */
export default async function CheckoutPage() {
  const season = await getOpenSeason();
  if (!season) redirect("/order");

  const owner = await resolveDraftOwner();
  const draft = await findActiveDraft(season.id, owner);
  if (!draft) redirect("/order");

  const customer = await getCustomerContext();
  const quote = await buildCheckoutQuote(
    season.id,
    parseCart(draft.cart),
    customer?.id ?? null,
    null,
    null
  );

  if ("error" in quote) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-xl font-bold">Checkout</h1>
        <p className="mt-4 rounded-md border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          {quote.error}
        </p>
        <Link href="/order" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
          ← Back to the order builder
        </Link>
      </main>
    );
  }

  const blockingIssues = [
    ...quote.priced.issues,
    ...quote.priced.lines.flatMap((line) => line.issues.map((issue) => `${line.productName}: ${issue}`)),
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-bold">Checkout</h1>
      <CheckoutForm
        itemsCents={quote.priced.totalCents}
        lines={quote.priced.lines.map((line) => ({
          id: line.id,
          productName: line.productName,
          quantity: line.quantity,
          lineTotalCents: line.lineTotalCents,
          recipientKey: line.assignment
            ? line.assignment.type === "onOrder"
              ? "onOrder"
              : line.assignment.type === "addressBook"
                ? `book:${line.assignment.addressId}`
                : "new"
            : "",
        }))}
        recipients={quote.recipients.map((recipient) => ({
          key: recipient.key,
          name: recipient.recipientName,
          summary: `${recipient.address.line1}, ${recipient.address.city} ${recipient.address.zip}`,
          zip: recipient.address.zip,
          rememberedGreeting: recipient.rememberedGreeting,
        }))}
        methods={quote.methods}
        deliveryZips={quote.config.deliveryZips}
        purimDayChoices={quote.config.purimDayChoices}
        initialIssues={blockingIssues}
        isGuest={!customer}
      />
    </main>
  );
}
