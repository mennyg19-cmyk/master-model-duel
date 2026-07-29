import { prisma } from "@/lib/db";
import { DomainRuleError } from "@/lib/errors";
import { canAccess, DraftAccess } from "@/lib/orders/drafts";
import { createCheckoutSession } from "@/lib/payments/stripe";
import { checkoutInclude } from "@/lib/checkout/order-load";

// Second half of checkout (R-166/G-007): hosted Stripe Checkout session
// against the frozen total. Requires a submitted checkout (stockReserved
// proves it ran) and the same open-season gate the submit path enforces.
export async function payCheckout(
  draftRef: string,
  access: DraftAccess,
  origin: string,
): Promise<{ checkoutUrl: string } | null> {
  const order = await prisma.order.findUnique({ where: { draftRef }, include: checkoutInclude });
  if (!order || !(await canAccess(order, access))) return null;
  if (order.status !== "DRAFT") {
    throw new DomainRuleError(`Order ${draftRef} is ${order.status}; expected DRAFT to pay`);
  }
  if (order.season.status !== "OPEN") {
    throw new DomainRuleError(`Season ${order.season.name} is closed; expected OPEN to check out`);
  }
  if (!order.stockReserved || order.recipients.some((recipient) => !recipient.fulfillmentChoice)) {
    throw new DomainRuleError("Submit the checkout summary first");
  }

  const session = await createCheckoutSession({
    orderId: order.id,
    draftRef,
    amountCents: order.totalCents,
    customerEmail: order.customer.email,
    successUrl: `${origin}/checkout?ref=${draftRef}&paid=1`,
    cancelUrl: `${origin}/checkout?ref=${draftRef}`,
  });
  await prisma.order.update({ where: { id: order.id }, data: { stripeSessionId: session.id } });
  return { checkoutUrl: session.url };
}
