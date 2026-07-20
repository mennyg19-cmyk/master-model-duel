import { randomUUID } from "node:crypto";
import { PaymentIntentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CheckoutConflictError,
  fulfillmentFees,
  prepareCheckout,
} from "@/domain/checkout";
import { quoteDraftShipping } from "@/domain/shipping";
import { findAccessibleDraft } from "@/lib/customer-access";
import { db } from "@/lib/db";
import {
  guardPublicWrite,
  publicRequestErrorResponse,
} from "@/lib/public-request";
import { getDeliveryZips } from "@/lib/store-settings";
import { getStripe } from "@/lib/stripe";
import { getShippingProvider } from "@/lib/shippo";

const checkoutSchema = z.object({
  method: z.literal("STRIPE"),
  defaultGreeting: z.string().trim().max(500),
  donationCents: z.number().int().min(0).max(1_000_000),
  expectedTotalCents: z.number().int().min(0),
  choices: z
    .array(
      z.object({
        orderLineId: z.string().min(1),
        fulfillmentCode: z.enum(Object.keys(fulfillmentFees) as [
          keyof typeof fulfillmentFees,
          ...(keyof typeof fulfillmentFees)[],
        ]),
        greeting: z.string().trim().max(500),
        deliveryDay: z.string().trim().max(40).nullable().optional(),
      }),
    )
    .min(1),
});

export async function GET(request: Request) {
  const draftId = new URL(request.url).searchParams.get("draftId");
  if (!draftId) {
    return NextResponse.json({ error: "Draft ID is required." }, { status: 400 });
  }
  const draft = await findAccessibleDraft(request, draftId);
  if (!draft) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }
  const [order, deliveryDays, deliveryZips] = await Promise.all([
    db.order.findUnique({
      where: { id: draft.id },
      include: {
        lines: {
          include: {
            recipientAddress: true,
            product: true,
          },
          orderBy: { id: "asc" },
        },
        season: {
          include: {
            fulfillmentMethods: {
              where: { isActive: true },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    }),
    db.appSetting.findUnique({ where: { key: "purim-delivery-days" } }),
    getDeliveryZips(),
  ]);
  const shippingProvider = getShippingProvider();
  let shippingFeesByAddressId: Record<string, number> = {};
  let shippingRateError: string | null = null;
  if (order && shippingProvider) {
    try {
      shippingFeesByAddressId = await quoteDraftShipping(
        db,
        shippingProvider,
        order.id,
      );
    } catch (error) {
      shippingRateError =
        error instanceof Error ? error.message : "Live shipping rates failed.";
    }
  }
  return NextResponse.json({
    order,
    fulfillmentFees,
    shippingFeesByAddressId,
    isLiveShippingAvailable: Boolean(shippingProvider) && !shippingRateError,
    shippingRateError,
    deliveryDays:
      deliveryDays && Array.isArray(deliveryDays.value)
        ? deliveryDays.value
        : ["Purim eve", "Purim day"],
    deliveryZips,
  });
}

export async function POST(request: Request) {
  try {
    await guardPublicWrite(request, "stripe-checkout");
    const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Checkout details are invalid.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const draftId = new URL(request.url).searchParams.get("draftId");
    if (!draftId) {
      return NextResponse.json({ error: "Draft ID is required." }, { status: 400 });
    }
    const draft = await findAccessibleDraft(request, draftId);
    if (!draft) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }

    const shippingProvider = getShippingProvider();
    const hasShipping = parsed.data.choices.some(
      (choice) => choice.fulfillmentCode === "SHIPPING",
    );
    if (hasShipping && !shippingProvider) {
      throw new CheckoutConflictError("Live shipping is not configured.", [
        "Choose another fulfillment method or ask staff to configure Shippo.",
      ]);
    }
    const shippingFeesByAddressId = hasShipping && shippingProvider
      ? await quoteDraftShipping(db, shippingProvider, draft.id)
      : {};
    const prepared = await prepareCheckout(
      db,
      draft.id,
      parsed.data.choices,
      parsed.data.defaultGreeting,
      parsed.data.donationCents,
      await getDeliveryZips(),
      new Map(Object.entries(shippingFeesByAddressId)),
    );
    if (parsed.data.expectedTotalCents !== prepared.totalCents) {
      return NextResponse.json(
        {
          error: "The checkout total changed. Review the current total before paying.",
          conflicts: [
            `Expected ${parsed.data.expectedTotalCents} cents; current total is ${prepared.totalCents} cents.`,
          ],
          totalCents: prepared.totalCents,
        },
        { status: 409 },
      );
    }

    const idempotencyKey = `checkout:${draft.id}:${prepared.totalCents}`;
    const existingIntent = await db.stripePaymentIntent.findUnique({
      where: { idempotencyKey },
    });
    if (existingIntent?.stripeCheckoutSessionId) {
      const stripe = getStripe();
      if (stripe) {
        const session = await stripe.checkout.sessions.retrieve(
          existingIntent.stripeCheckoutSessionId,
        );
        return NextResponse.json({ url: session.url, sessionId: session.id });
      }
      return NextResponse.json({
        url: `/checkout/test?session=${encodeURIComponent(existingIntent.stripeCheckoutSessionId)}`,
        sessionId: existingIntent.stripeCheckoutSessionId,
      });
    }

    await db.stripePaymentIntent.upsert({
      where: { idempotencyKey },
      create: {
        orderId: draft.id,
        stripePaymentIntentId: `pending:${idempotencyKey}`,
        idempotencyKey,
        status: PaymentIntentStatus.CREATED,
        amountCents: prepared.totalCents,
      },
      update: {
        status: PaymentIntentStatus.CREATED,
        amountCents: prepared.totalCents,
      },
    });

    const stripe = getStripe();
    let sessionId: string;
    let checkoutUrl: string | null;
    if (stripe) {
      const configuredBaseUrl = process.env.APP_BASE_URL;
      if (!configuredBaseUrl) {
        return NextResponse.json(
          { error: "The trusted application base URL is not configured." },
          { status: 503 },
        );
      }
      const applicationBaseUrl = new URL(configuredBaseUrl);
      if (!["http:", "https:"].includes(applicationBaseUrl.protocol)) {
        return NextResponse.json(
          { error: "The trusted application base URL is invalid." },
          { status: 503 },
        );
      }
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: draft.id,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: prepared.totalCents,
                product_data: { name: `Tomchei Shabbos order ${draft.draftReference}` },
              },
            },
          ],
          payment_intent_data: {
            capture_method: "automatic",
            metadata: { orderId: draft.id },
          },
          metadata: { orderId: draft.id },
          success_url: new URL(
            `/account/orders/${draft.id}?paid=1`,
            applicationBaseUrl,
          ).toString(),
          cancel_url: new URL(
            `/checkout/${draft.id}?cancelled=1`,
            applicationBaseUrl,
          ).toString(),
        },
        { idempotencyKey },
      );
      sessionId = session.id;
      checkoutUrl = session.url;
    } else {
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
          { error: "Stripe is not configured for checkout." },
          { status: 503 },
        );
      }
      sessionId = `cs_test_local_${randomUUID()}`;
      checkoutUrl = `/checkout/test?session=${encodeURIComponent(sessionId)}`;
    }

    await db.stripePaymentIntent.update({
      where: { idempotencyKey },
      data: {
        stripePaymentIntentId: `pending:${sessionId}`,
        stripeCheckoutSessionId: sessionId,
        status: PaymentIntentStatus.CREATED,
        amountCents: prepared.totalCents,
      },
    });
    return NextResponse.json({ url: checkoutUrl, sessionId });
  } catch (error) {
    if (error instanceof CheckoutConflictError) {
      return NextResponse.json(
        { error: error.message, conflicts: error.conflicts },
        { status: 409 },
      );
    }
    return publicRequestErrorResponse(error);
  }
}
