import 'server-only';

import { env } from '../env';
import { createLocalGateway } from './local-gateway';
import { createStripeGateway } from './stripe-api';

/**
 * One way to take a card, whoever is behind it (R-166, R-170).
 *
 * Hosted checkout only: the card number is typed on the provider's page and
 * never reaches this application, which is the whole reason there is no client
 * Stripe package anywhere in the bundle (resolution 8b).
 */
export type CheckoutSessionRequest = {
  orderId: string;
  /** What the customer will see on the payment page and their statement. */
  description: string;
  amountCents: number;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
  /** Replaying the same key must not open a second session or take a second payment. */
  idempotencyKey: string;
};

export type HostedCheckoutSession = { sessionId: string; url: string };

export type RefundRequest = {
  paymentIntentId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
};

export type RefundReceipt = { refundId: string; amountCents: number };

export type PaymentGateway = {
  readonly name: 'stripe' | 'local';
  createCheckoutSession(request: CheckoutSessionRequest): Promise<HostedCheckoutSession>;
  refund(request: RefundRequest): Promise<RefundReceipt>;
};

let gateway: PaymentGateway | null = null;

/**
 * Built on first use and kept (R-170). Constructing it at module load would
 * make every route that merely imports this file demand a payment
 * configuration, including the ones that never take money.
 */
export function getPaymentGateway(): PaymentGateway {
  gateway ??= env.PAYMENT_PROVIDER === 'stripe' ? createStripeGateway() : createLocalGateway();
  return gateway;
}
