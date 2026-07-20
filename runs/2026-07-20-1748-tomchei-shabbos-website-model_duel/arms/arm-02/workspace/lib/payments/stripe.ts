import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// Stripe gateway (R-166, R-170). Two implementations behind one type:
// - real: Stripe's REST API over fetch — no SDK package (resolution 8b bans
//   client Stripe packages, and the ladder says no new dep when fetch does it).
// - mock: used when STRIPE_SECRET_KEY is unset (this harness has no keys).
//   Hosted checkout becomes a local /dev/stripe-checkout page whose "pay"
//   posts a SIGNED event through the real webhook route, so signature
//   verification, idempotency, and the money path run the same code either way.
// The gateway is a lazy singleton: nothing touches env/Stripe until the first
// payment call, so builds and unrelated routes never pay the cost.

export type CheckoutSessionRequest = {
  reference: string;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSession = { sessionId: string; url: string };

export type RefundResult = { refundId: string; amountCents: number };

export type PaymentGateway = {
  mode: "stripe" | "mock";
  createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession>;
  /** Full or partial refund against a payment intent. */
  createRefund(paymentIntentId: string, amountCents: number): Promise<RefundResult>;
};

const STRIPE_API = "https://api.stripe.com/v1";

async function stripeRequest<T>(secretKey: string, path: string, form: Record<string, string>): Promise<T> {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(`Stripe ${path} failed (${response.status}): ${body.error?.message ?? "unknown error"}`);
  }
  return body;
}

function realGateway(secretKey: string): PaymentGateway {
  return {
    mode: "stripe",
    async createCheckoutSession(request) {
      const session = await stripeRequest<{ id: string; url: string }>(secretKey, "/checkout/sessions", {
        mode: "payment",
        // Immediate capture (R-166, UR-013 capture half): the default
        // capture_method for Checkout is automatic — funds are captured at pay.
        "payment_method_types[0]": "card",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][product_data][name]": `Mishloach Manos order ${request.reference}`,
        "line_items[0][price_data][unit_amount]": String(request.amountCents),
        "line_items[0][quantity]": "1",
        client_reference_id: request.reference,
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
      });
      return { sessionId: session.id, url: session.url };
    },
    async createRefund(paymentIntentId, amountCents) {
      const refund = await stripeRequest<{ id: string; amount: number }>(secretKey, "/refunds", {
        payment_intent: paymentIntentId,
        amount: String(amountCents),
      });
      return { refundId: refund.id, amountCents: refund.amount };
    },
  };
}

function mockGateway(): PaymentGateway {
  return {
    mode: "mock",
    async createCheckoutSession(request) {
      const sessionId = `cs_mock_${randomBytes(12).toString("hex")}`;
      const url = new URL("/dev/stripe-checkout", env.APP_URL);
      url.searchParams.set("session", sessionId);
      url.searchParams.set("success", request.successUrl);
      url.searchParams.set("cancel", request.cancelUrl);
      return { sessionId, url: url.toString() };
    },
    async createRefund(_paymentIntentId, amountCents) {
      return { refundId: `re_mock_${randomBytes(12).toString("hex")}`, amountCents };
    },
  };
}

let gateway: PaymentGateway | null = null;

export function getPaymentGateway(): PaymentGateway {
  if (!gateway) {
    // Fail closed (env.ts enforces this at startup too): a production deploy
    // that lost its Stripe key must error, never silently accept mock "payments".
    if (!env.STRIPE_SECRET_KEY && process.env.NODE_ENV === "production") {
      throw new Error("The mock payment gateway is dev-only — set STRIPE_SECRET_KEY in production");
    }
    gateway = env.STRIPE_SECRET_KEY ? realGateway(env.STRIPE_SECRET_KEY) : mockGateway();
  }
  return gateway;
}
