import 'server-only';

import { z } from 'zod';

import { env } from '../env';
import type {
  CheckoutSessionRequest,
  HostedCheckoutSession,
  PaymentGateway,
  RefundReceipt,
  RefundRequest,
} from './gateway';

/**
 * The two Stripe calls this application makes, over `fetch` against the REST
 * API. Stripe's own SDK would add a dependency to do what two form posts do,
 * and hosted checkout means there is no client-side surface to support.
 *
 * Everything about the money — what was charged, whether it arrived — comes back
 * through the webhook. These calls only open a page and hand money back.
 */
const STRIPE_API = 'https://api.stripe.com/v1';
const REQUEST_TIMEOUT_MS = 15_000;

const sessionSchema = z.object({ id: z.string(), url: z.string() });
const refundSchema = z.object({ id: z.string(), amount: z.number().int() });

export function createStripeGateway(): PaymentGateway {
  const secretKey = env.STRIPE_SECRET_KEY;

  // The env schema already refuses this combination; the check is here so the
  // failure is a sentence rather than an Authorization header reading "Bearer
  // undefined" and a 401 from Stripe.
  if (!secretKey) {
    throw new Error('PAYMENT_PROVIDER=stripe needs STRIPE_SECRET_KEY, which is empty.');
  }

  return {
    name: 'stripe',

    async createCheckoutSession(request: CheckoutSessionRequest): Promise<HostedCheckoutSession> {
      const form = new URLSearchParams({
        mode: 'payment',
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        client_reference_id: request.orderId,
        'metadata[orderId]': request.orderId,
        // Immediate capture (R-166): the org ships against paid orders, so an
        // authorization it has to remember to capture is a way to lose money.
        'payment_intent_data[capture_method]': 'automatic',
        'payment_intent_data[metadata][orderId]': request.orderId,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(request.amountCents),
        'line_items[0][price_data][product_data][name]': request.description,
      });

      if (request.customerEmail) form.set('customer_email', request.customerEmail);

      const session = sessionSchema.parse(
        await post('checkout/sessions', form, secretKey, request.idempotencyKey),
      );

      return { sessionId: session.id, url: session.url };
    },

    async refund(request: RefundRequest): Promise<RefundReceipt> {
      const form = new URLSearchParams({
        payment_intent: request.paymentIntentId,
        amount: String(request.amountCents),
        // Stripe's own `reason` takes three fixed values, none of which is
        // "we charged the wrong amount", so ours travels as metadata.
        'metadata[reason]': request.reason,
      });

      const refund = refundSchema.parse(
        await post('refunds', form, secretKey, request.idempotencyKey),
      );

      return { refundId: refund.id, amountCents: refund.amount };
    },
  };
}

async function post(
  path: string,
  form: URLSearchParams,
  secretKey: string,
  idempotencyKey: string,
): Promise<unknown> {
  const response = await fetch(`${STRIPE_API}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': idempotencyKey,
    },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body: unknown = await response.json();

  if (!response.ok) {
    // Stripe's message describes what it refused, which is what the operator
    // needs in the log. Nothing from here reaches the customer.
    throw new Error(`Stripe ${path} returned ${response.status}: ${stripeErrorMessage(body)}`);
  }

  return body;
}

const errorSchema = z.object({ error: z.object({ message: z.string() }) });

function stripeErrorMessage(body: unknown): string {
  const parsed = errorSchema.safeParse(body);
  return parsed.success ? parsed.data.error.message : 'no error message in the response';
}
