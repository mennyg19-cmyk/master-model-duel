import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * Browser crash reports. The body is bounded and the fields are truncated
 * before logging so a hostile page cannot flood the server log, and nothing
 * from the request is ever echoed back to the caller.
 */
const MAX_BODY_BYTES = 4_000;

const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 60;

const reportSchema = z.object({
  message: z.string().max(500),
  digest: z.string().max(120).optional(),
  path: z.string().max(300).optional(),
});

/**
 * The endpoint has to stay open — a crashing page has no session to present —
 * so the cap is global rather than per caller. Anything keyed on the client
 * address would be keyed on a header the caller writes, which caps nothing.
 */
let rateWindow = { startedAt: 0, count: 0 };

function withinRateLimit(): boolean {
  const now = Date.now();
  if (now - rateWindow.startedAt > RATE_LIMIT_WINDOW_MS) rateWindow = { startedAt: now, count: 0 };

  rateWindow.count += 1;
  return rateWindow.count <= MAX_REPORTS_PER_WINDOW;
}

export async function POST(request: Request) {
  if (!withinRateLimit()) {
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
