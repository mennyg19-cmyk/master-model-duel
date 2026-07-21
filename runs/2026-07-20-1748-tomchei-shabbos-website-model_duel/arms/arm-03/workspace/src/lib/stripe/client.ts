import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

export type StripeMode = "live" | "test" | "mock";

let stripeSingleton: import("stripe").default | null | undefined;

export function getStripeMode(): StripeMode {
  const mode = (process.env.STRIPE_MODE ?? "").trim().toLowerCase();
  if (mode === "mock") return "mock";
  if (mode === "live") return "live";
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key || key.includes("mock") || key === "sk_test_mock") return "mock";
  return "test";
}

/** Lazy Stripe singleton (R-170). No client Stripe packages. */
export function getStripe(): import("stripe").default | null {
  if (getStripeMode() === "mock") return null;
  if (stripeSingleton !== undefined) return stripeSingleton;
  // Dynamic require keeps mock smoke working without network.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Stripe = require("stripe") as typeof import("stripe").default;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    stripeSingleton = null;
    return null;
  }
  // apiVersion pinned by installed stripe package defaults when omitted.
  stripeSingleton = new Stripe(key);
  return stripeSingleton;
}

export function resetStripeSingleton() {
  stripeSingleton = undefined;
}

export function mintMockSessionId(): string {
  return `cs_mock_${randomBytes(12).toString("hex")}`;
}

export function mintMockPaymentIntentId(): string {
  return `pi_mock_${randomBytes(12).toString("hex")}`;
}

export function mintMockEventId(): string {
  return `evt_mock_${randomBytes(12).toString("hex")}`;
}

export function webhookSecret(): string {
  const value = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!value) {
    if (getStripeMode() === "mock") return "whsec_mock_dev_only";
    throw new Error("STRIPE_WEBHOOK_SECRET is required");
  }
  return value;
}

/** Construct Stripe-compatible signed payload for mock + verify path. */
export function signWebhookPayload(payload: string, secret = webhookSecret()): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signed}`;
}

export function verifyWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  secret = webhookSecret(),
): boolean {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, ...rest] = p.split("=");
      return [k, rest.join("=")];
    }),
  ) as { t?: string; v1?: string };
  if (!parts.t || !parts.v1) return false;
  const expected = createHmac("sha256", secret)
    .update(`${parts.t}.${payload}`)
    .digest("hex");
  const a = Buffer.from(parts.v1);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function appUrl(): string {
  return getEnv().APP_URL.replace(/\/$/, "");
}
