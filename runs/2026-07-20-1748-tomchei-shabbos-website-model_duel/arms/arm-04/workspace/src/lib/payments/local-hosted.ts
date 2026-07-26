import 'server-only';

import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { env } from '../env';
import { LOCAL_INTENT_PREFIX, LOCAL_SESSION_PREFIX } from './local-gateway';
import { signStripePayload } from './stripe-signature';

/**
 * The offline stand-in's payment page, and the callback it sends afterwards.
 *
 * The point of doing it this way is that development and CI run the production
 * path: the event is signed with the real secret, posted over HTTP to the real
 * webhook route, and verified, claimed and applied by the real handler. The
 * only fiction is that no card is charged.
 *
 * The event id is derived from the session, so pressing "pay" twice is the same
 * event twice — which is exactly the duplicate delivery the provider is famous
 * for, and the case the idempotency key exists to survive.
 */
/** The provider is not the stand-in, so this page should not have been reachable. */
export const LOCAL_PAY_UNAVAILABLE = 'local_pay_unavailable';
/** The callback was sent and did not land — worth another press of the button. */
export const LOCAL_PAY_FAILED = 'local_pay_failed';
export const LOCAL_SESSION_NOT_FOUND = 'local_session_not_found';

export type LocalHostedSession = {
  sessionId: string;
  orderId: string;
  orderLabel: string;
  amountCents: number;
  status: string;
};

export function localPaymentsEnabled(): boolean {
  return env.PAYMENT_PROVIDER === 'local';
}

export async function readLocalHostedSession(sessionId: string): Promise<LocalHostedSession | null> {
  if (!localPaymentsEnabled() || !sessionId.startsWith(LOCAL_SESSION_PREFIX)) return null;

  const attempt = await db.stripePaymentIntent.findUnique({
    where: { stripeSessionId: sessionId },
    include: { order: { select: { orderNumber: true, draftReference: true } } },
  });
  if (!attempt) return null;

  return {
    sessionId,
    orderId: attempt.orderId,
    orderLabel:
      attempt.order.orderNumber === null
        ? attempt.order.draftReference
        : `Order #${attempt.order.orderNumber}`,
    amountCents: attempt.amountCents,
    status: attempt.status,
  };
}

/**
 * `chargedCents` is what the "provider" reports it took. It is a parameter
 * rather than a read of the order because the amount safety check (R-126) can
 * only be exercised by a callback that disagrees with the order, and a test
 * that cannot produce one cannot prove the refund path works.
 */
export async function payLocalHostedSession(
  sessionId: string,
  chargedCents?: number,
): Promise<Result<{ outcome: string }>> {
  if (!localPaymentsEnabled()) {
    return failure(LOCAL_PAY_UNAVAILABLE, 'This deployment takes payments through the provider.');
  }

  const session = await readLocalHostedSession(sessionId);
  if (!session) return failure(LOCAL_SESSION_NOT_FOUND, 'That payment page has expired.');

  return postSignedEvent({
    id: `evt_local_${sessionId}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        payment_intent: sessionId.replace(LOCAL_SESSION_PREFIX, LOCAL_INTENT_PREFIX),
        amount_total: chargedCents ?? session.amountCents,
        payment_status: 'paid',
      },
    },
  });
}

async function postSignedEvent(event: unknown): Promise<Result<{ outcome: string }>> {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);

  const response = await fetch(new URL('/api/webhooks/stripe', env.APP_URL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signStripePayload(payload, env.STRIPE_WEBHOOK_SECRET, timestamp),
    },
    body: payload,
  });

  if (!response.ok) {
    return failure(LOCAL_PAY_FAILED, 'The payment could not be recorded. Try again.');
  }

  const body = (await response.json()) as { outcome?: string };
  return ok({ outcome: body.outcome ?? 'unknown' });
}
