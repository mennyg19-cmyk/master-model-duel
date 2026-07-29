import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

// R-170: one lazy Stripe server client. ponytail ladder — native fetch +
// node:crypto cover the two calls P5 needs (hosted Checkout session create,
// refund) plus webhook signature verification, so the stripe npm package is
// not a dependency. No client Stripe packages anywhere (resolution 8b).

export class StripeNotConfiguredError extends Error {
  constructor() {
    // Public-facing text: the pay route maps this error to the 503 body.
    super("Card payment is not configured on this deployment yet (STRIPE_SECRET_KEY missing)");
    this.name = "StripeNotConfiguredError";
  }
}

interface StripeConfig {
  secretKey: string | null;
  webhookSecret: string | null;
  baseUrl: string;
}

let stripeConfigCache: StripeConfig | null = null;

export function getStripeConfig(): StripeConfig {
  if (!stripeConfigCache) {
    stripeConfigCache = {
      secretKey: env.STRIPE_SECRET_KEY ?? null,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
      // P12 (R-093): base-URL seam for the dev double, same honesty class as
      // SHIPPO_BASE_URL / RESEND_BASE_URL. The reconciliation matcher lists
      // intents through this; checkout/refund stay pinned to api.stripe.com.
      baseUrl: (env.STRIPE_BASE_URL ?? STRIPE_API).replace(/\/+$/, ""),
    };
  }
  return stripeConfigCache;
}

const STRIPE_API = "https://api.stripe.com";

// Reconciliation driver mode (snapshot on each run row): live = real keys
// against the real API; fixture = the dev double over HTTP; capture = no key
// and no double — the matcher can only audit local mirrors, reported as such.
export type StripeDriverMode = "live" | "fixture" | "capture";

export function stripeDriverMode(): StripeDriverMode {
  const { secretKey, baseUrl } = getStripeConfig();
  if (baseUrl !== STRIPE_API) return "fixture";
  return secretKey ? "live" : "capture";
}

async function stripePost<T>(path: string, params: URLSearchParams, idempotencyKey?: string): Promise<T> {
  const { secretKey } = getStripeConfig();
  if (!secretKey) throw new StripeNotConfiguredError();
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: params.toString(),
  });
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok) {
    throw new Error(`Stripe ${path} failed (${response.status}): ${body?.error?.message ?? "unknown"}`);
  }
  return body as T;
}

// R-166/G-007: hosted Checkout, mode=payment → immediate capture (no
// authorization/capture later step). One line item priced at the frozen
// server total — Stripe never sees client-supplied amounts.
export async function createCheckoutSession(input: {
  orderId: string;
  draftRef: string;
  amountCents: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  const params = new URLSearchParams({
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.draftRef,
    customer_email: input.customerEmail,
    "metadata[orderId]": input.orderId,
    "payment_intent_data[metadata][orderId]": input.orderId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(input.amountCents),
    "line_items[0][price_data][product_data][name]": `Mishloach Manos order ${input.draftRef}`,
  });
  return stripePost<{ id: string; url: string }>(
    "/v1/checkout/sessions",
    params,
    // Retries of the same checkout attempt reuse one session server-side.
    `checkout-${input.orderId}`,
  );
}

export async function createRefund(paymentIntentId: string): Promise<{ id: string }> {
  const params = new URLSearchParams({ payment_intent: paymentIntentId });
  return stripePost<{ id: string }>("/v1/refunds", params, `refund-${paymentIntentId}`);
}

// R-093: the one Stripe read the matcher needs. Pages through
// /v1/payment_intents against the configured base URL (live API or the dev
// double). Fixture mode authenticates with a stand-in bearer — the double
// ignores it; capture mode (no key, no double) refuses exactly like writes.
export interface StripeIntentSummary {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  metadata: Record<string, string>;
}

export async function listPaymentIntents(limit = 100): Promise<StripeIntentSummary[]> {
  const { secretKey, baseUrl } = getStripeConfig();
  const bearer = secretKey ?? "fixture-key";
  if (!secretKey && baseUrl === STRIPE_API) throw new StripeNotConfiguredError();

  const intents: StripeIntentSummary[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (startingAfter) query.set("starting_after", startingAfter);
    const response = await fetch(`${baseUrl}/v1/payment_intents?${query.toString()}`, {
      headers: { authorization: `Bearer ${bearer}` },
    });
    const body = (await response.json().catch(() => null)) as {
      data?: { id: string; amount: number; currency: string; status: string; metadata?: Record<string, string> }[];
      has_more?: boolean;
      error?: { message?: string };
    } | null;
    if (!response.ok) {
      throw new Error(`Stripe list payment_intents failed (${response.status}): ${body?.error?.message ?? "unknown"}`);
    }
    for (const intent of body?.data ?? []) {
      intents.push({
        id: intent.id,
        amountCents: intent.amount,
        currency: intent.currency,
        status: intent.status,
        metadata: intent.metadata ?? {},
      });
    }
    if (!body?.has_more || (body.data ?? []).length === 0) return intents;
    startingAfter = body!.data![body!.data!.length - 1].id;
  }
}

const SIGNATURE_TOLERANCE_SECONDS = 300;

// R-125 authenticity: v1 = HMAC-SHA256(`${t}.${rawBody}`, webhook secret),
// compared timing-safe, with a 5-minute replay window. Verification runs on
// the RAW body — never a re-serialized parse.
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!signatureHeader) return false;
  const parts = new Map(
    signatureHeader.split(",").map((pair) => {
      const eq = pair.indexOf("=");
      return [pair.slice(0, eq), pair.slice(eq + 1)] as const;
    }),
  );
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature) return false;
  const age = Math.abs(nowSeconds - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const signatureBuf = Buffer.from(signature, "utf8");
  return expectedBuf.length === signatureBuf.length && timingSafeEqual(expectedBuf, signatureBuf);
}

// Test/dev fixture path: sign a payload exactly the way Stripe would, so
// smoke scripts exercise the real verification branch (documented seam when
// no live keys exist on the host).
export function signWebhookFixture(rawBody: string, secret: string, timestamp?: number): string {
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}
