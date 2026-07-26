import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { rateLimitCaller, withinRateLimit } from '@/lib/http/public-guards';
import { SIGNATURE_HEADER, verifyStripeSignature } from '@/lib/payments/stripe-signature';
import { applyStripeEvent, parseStripeEvent } from '@/lib/payments/webhook-service';

/**
 * The one endpoint the payment provider calls (R-125, R-167).
 *
 * It is public and cannot be same-origin checked — the provider is not our
 * origin — so the signature is the whole of its authenticity, and the body is
 * read as raw text because signing covers the exact bytes sent. What it can say
 * is that no browser belongs here at all: a server-to-server caller sends no
 * `Origin`, and one that does is a page, not a provider.
 *
 * Every answer is deliberately terse. An error message that explained what was
 * wrong with a forged request would be a free oracle for the next attempt, and
 * a 200 with a body the provider ignores is all a genuine caller needs.
 */
const MAX_BODY_BYTES = 64_000;

const RATE_LIMIT = { limit: 240, windowMs: 60_000 };

export async function POST(request: Request) {
  if (request.headers.has('origin')) return NextResponse.json({ received: false }, { status: 403 });

  if (!withinRateLimit('stripe-webhook', rateLimitCaller(request.headers), RATE_LIMIT)) {
    return NextResponse.json({ received: false }, { status: 429 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ received: false }, { status: 413 });

  const signature = verifyStripeSignature(
    raw,
    request.headers.get(SIGNATURE_HEADER),
    env.STRIPE_WEBHOOK_SECRET,
  );
  if (!signature.ok) return NextResponse.json({ received: false }, { status: 400 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  const event = parseStripeEvent(body);
  if (!event.ok) return NextResponse.json({ received: false }, { status: 400 });

  // Anything thrown past this point is a fault of ours, and the 500 it becomes
  // is what makes the provider retry — which the idempotency key then makes
  // safe. Swallowing it into a 200 would lose the payment quietly.
  const outcome = await applyStripeEvent(event.value);

  return NextResponse.json({ received: true, outcome });
}
