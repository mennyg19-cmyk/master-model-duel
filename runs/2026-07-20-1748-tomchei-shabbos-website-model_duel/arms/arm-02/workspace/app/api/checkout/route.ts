import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getOpenSeason } from "@/lib/season";
import { guardPublicEndpoint } from "@/lib/public-guard";
import { parseCart, resolveDraftOwner, findActiveDraft } from "@/lib/order-builder/draft-store";
import { createOrderFromCart } from "@/lib/checkout/create-order";
import { getPaymentGateway } from "@/lib/payments/stripe";

const checkoutSchema = z.object({
  choices: z.array(z.object({ recipientKey: z.string().min(1), methodId: z.string().min(1) })).max(200),
  deliveryDay: z.string().max(100).nullable().default(null),
  greetingDefault: z.string().max(500).default(""),
  greetingOverrides: z
    .array(z.object({ recipientKey: z.string().min(1), greeting: z.string().max(500) }))
    .max(200)
    .default([]),
  donationCents: z.number().int().min(0).max(1_000_000).default(0),
  expectedTotalCents: z.number().int().min(1),
  guestContact: z
    .object({
      email: z.string().email().max(200),
      name: z.string().min(1).max(200),
      phone: z.string().max(30).optional(),
    })
    .nullable()
    .default(null),
});

/**
 * Places the order (R-035): validates the draft against live prices/stock,
 * creates the DRAFT Order with snapshots, opens a hosted Stripe Checkout
 * session (R-166), and returns its URL. Stale carts and tampered totals get a
 * 409 with the fresh numbers (R-037) — never an order.
 */
export async function POST(request: Request) {
  const blocked = guardPublicEndpoint(request, "checkout", 20, 60_000);
  if (blocked) return blocked;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "The store is closed" }, { status: 409 });

  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Checkout payload is invalid" }, { status: 400 });
  }

  const owner = await resolveDraftOwner();
  const draft = await findActiveDraft(season.id, owner);
  if (!draft) return Response.json({ error: "No active order draft" }, { status: 409 });

  const result = await createOrderFromCart({
    cart: parseCart(draft.cart),
    customerId: owner.kind === "customer" ? owner.customerId : null,
    guestContact: parsed.data.guestContact,
    choices: parsed.data.choices,
    deliveryDay: parsed.data.deliveryDay,
    greetingDefault: parsed.data.greetingDefault,
    greetingOverrides: parsed.data.greetingOverrides,
    donationCents: parsed.data.donationCents,
    expectedTotalCents: parsed.data.expectedTotalCents,
    sourceDraftId: draft.id,
  });

  if (result.kind === "conflict") {
    return Response.json(
      { error: "conflict", messages: result.errors, freshTotalCents: result.freshTotalCents },
      { status: 409 }
    );
  }

  const gateway = getPaymentGateway();
  const session = await gateway.createCheckoutSession({
    reference: result.draftReference,
    amountCents: result.totalCents,
    successUrl: `${env.APP_URL}/checkout/success?ref=${result.draftReference}`,
    cancelUrl: `${env.APP_URL}/checkout`,
  });
  await db.stripeCheckoutSession.create({
    data: {
      orderId: result.orderId,
      stripeSessionId: session.sessionId,
      amountCents: result.totalCents,
    },
  });

  return Response.json({ url: session.url, draftReference: result.draftReference });
}
