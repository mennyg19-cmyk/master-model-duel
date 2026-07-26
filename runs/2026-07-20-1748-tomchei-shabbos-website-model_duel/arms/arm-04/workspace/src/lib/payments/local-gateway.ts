import 'server-only';

import { randomBytes } from 'node:crypto';

import { env } from '../env';
import type {
  HostedCheckoutSession,
  PaymentGateway,
  RefundReceipt,
  RefundRequest,
} from './gateway';

/**
 * The offline stand-in for hosted checkout.
 *
 * It hosts the payment page at `/checkout/hosted/{sessionId}` and, when that
 * page is used, posts a signed event to the same webhook route Stripe posts to.
 * Nothing about verification, idempotency, the amount safety check or refund
 * handling is skipped or stubbed — only the card form and the money are.
 *
 * The env schema refuses this provider unless the app answers on loopback, so a
 * page that takes no money can never be shown to a real customer.
 */
export const LOCAL_SESSION_PREFIX = 'cs_local_';
export const LOCAL_INTENT_PREFIX = 'pi_local_';
const LOCAL_REFUND_PREFIX = 're_local_';

export function createLocalGateway(): PaymentGateway {
  return {
    name: 'local',

    // The request is not needed here: the hosted page reads the order and the
    // amount from the checkout-attempt row this session id keys, exactly as the
    // webhook handler does when the real provider calls back.
    async createCheckoutSession(): Promise<HostedCheckoutSession> {
      const sessionId = `${LOCAL_SESSION_PREFIX}${randomBytes(12).toString('hex')}`;

      return {
        sessionId,
        url: new URL(`/checkout/hosted/${sessionId}`, env.APP_URL).toString(),
      };
    },

    async refund(request: RefundRequest): Promise<RefundReceipt> {
      return {
        refundId: `${LOCAL_REFUND_PREFIX}${randomBytes(12).toString('hex')}`,
        amountCents: request.amountCents,
      };
    },
  };
}
