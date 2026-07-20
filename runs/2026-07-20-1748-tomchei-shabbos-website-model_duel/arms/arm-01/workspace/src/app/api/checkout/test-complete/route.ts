import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { commitStripePayment } from "@/domain/checkout";
import { db } from "@/lib/db";
import { guardPublicWrite, publicRequestErrorResponse } from "@/lib/public-request";

const testCheckoutSchema = z.object({ sessionId: z.string().startsWith("cs_test_local_") });

export async function POST(request: Request) {
  try {
    if (process.env.NODE_ENV === "production" || process.env.ENABLE_TEST_AUTH !== "true") {
      return NextResponse.json({ error: "Local Stripe checkout is disabled." }, { status: 404 });
    }
    await guardPublicWrite(request, "local-stripe-checkout");
    const parsed = testCheckoutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "A valid test session is required." }, { status: 400 });
    }
    const intent = await db.stripePaymentIntent.findUnique({
      where: { stripeCheckoutSessionId: parsed.data.sessionId },
    });
    if (!intent) {
      return NextResponse.json({ error: "Test checkout session was not found." }, { status: 404 });
    }
    const paymentIntentId = `pi_local_${randomUUID()}`;
    const outcome = await commitStripePayment(
      db,
      `evt_local_${randomUUID()}`,
      intent.orderId,
      paymentIntentId,
      intent.amountCents,
    );
    return NextResponse.json({ paid: true, orderId: intent.orderId, ...outcome });
  } catch (error) {
    return publicRequestErrorResponse(error);
  }
}
