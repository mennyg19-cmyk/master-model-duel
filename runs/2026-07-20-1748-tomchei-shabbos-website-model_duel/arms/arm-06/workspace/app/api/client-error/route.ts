import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";

// Bounded + redacted (R-132): hard length caps, only the first stack line,
// no request bodies or cookies accepted. Per-process sliding-window cap keeps
// the unauthenticated endpoint from flooding the audit trail with noise.
const clientErrorSchema = z.object({
  message: z.string().max(500),
  url: z.string().max(500).optional(),
  stackFirstLine: z.string().max(300).optional(),
});

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const recentHits: number[] = [];

function isRateLimited(): boolean {
  const now = Date.now();
  while (recentHits.length > 0 && recentHits[0] < now - WINDOW_MS) {
    recentHits.shift();
  }
  if (recentHits.length >= MAX_PER_WINDOW) return true;
  recentHits.push(now);
  return false;
}

export async function POST(request: Request) {
  if (isRateLimited()) {
    return NextResponse.json({ error: "Too many error reports" }, { status: 429 });
  }
  const parsed = await parseBody(request, clientErrorSchema, "Invalid error report");
  if (!parsed.ok) return parsed.response;
  await recordAudit({ action: "client_error", metadata: parsed.data });
  return new NextResponse(null, { status: 204 });
}
