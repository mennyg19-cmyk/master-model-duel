import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  stripeClient ??= new Stripe(secretKey);
  return stripeClient;
}

export function requireStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required to verify Stripe events.");
  }
  return secret;
}

export function constructStripeEvent(payload: string, signature: string) {
  const stripe = getStripe() ?? new Stripe("sk_test_local_webhook_verification");
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    requireStripeWebhookSecret(),
  );
}
