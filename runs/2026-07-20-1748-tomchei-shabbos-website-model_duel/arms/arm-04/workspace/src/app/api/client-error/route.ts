import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isSameOrigin, withinRateLimit } from '@/lib/http/public-guards';

/**
 * Browser crash reports. The body is bounded and the fields are truncated
 * before logging so a hostile page cannot flood the server log, and nothing
 * from the request is ever echoed back to the caller.
 */
const MAX_BODY_BYTES = 4_000;

/**
 * The endpoint has to stay open — a crashing page has no session to present —
 * so the cap is one global window rather than one per caller. Anything keyed on
 * the client address would be keyed on a header the caller writes, which caps
 * nothing.
 */
const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

const reportSchema = z.object({
  message: z.string().max(500),
  digest: z.string().max(120).optional(),
  path: z.string().max(300).optional(),
});

export async function POST(request: Request) {
  // Our own error boundaries are the only thing that should be posting here.
  // The Stripe webhook is the one public endpoint that cannot ask this, because
  // the caller is a payment provider and answers with a signature instead.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ accepted: false }, { status: 403 });
  }

  if (!withinRateLimit('client-error', 'all-callers', RATE_LIMIT)) {
    return NextResponse.json({ accepted: false }, { status: 429 });
  }

  const raw = await request.text();

  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ accepted: false }, { status: 413 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return NextResponse.json({ accepted: false }, { status: 400 });
  }

  const report = reportSchema.safeParse(parsedJson);
  if (!report.success) {
    return NextResponse.json({ accepted: false }, { status: 400 });
  }

  console.error('[client-error]', {
    message: report.data.message,
    digest: report.data.digest,
    path: report.data.path,
  });

  return NextResponse.json({ accepted: true });
}
