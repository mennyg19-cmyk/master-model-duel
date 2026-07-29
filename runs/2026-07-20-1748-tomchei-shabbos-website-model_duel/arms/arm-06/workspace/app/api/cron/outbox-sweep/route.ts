import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { mapDomainError } from "@/lib/http-errors";
import { sweepOutbox } from "@/lib/email/outbox-sweep";

export const dynamic = "force-dynamic";

// R-181/R-088: the transactional outbox sweeper, Vercel Cron (GET + bearer).
// Drains PENDING email/SMS rows through the Resend/Twilio drivers (or the
// capture double on a keyless host) with retry; every run leaves a CronRun
// row. Overlapping invocations are safe — the per-row atomic claim gives each
// message to exactly one sweep.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await sweepOutbox();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
