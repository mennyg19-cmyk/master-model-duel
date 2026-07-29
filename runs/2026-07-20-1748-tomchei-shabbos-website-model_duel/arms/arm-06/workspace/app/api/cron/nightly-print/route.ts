import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { mapDomainError } from "@/lib/http-errors";
import { runNightlyPrintBatch } from "@/lib/packages/print-batches";

export const dynamic = "force-dynamic";

// UR-005/R-124: the nightly print batch, triggered by Vercel Cron (GET with
// an Authorization bearer). Every run — empty or not — leaves a CronRun row.
// The bearer check comes first and is constant-time, so an unauthenticated
// caller can neither probe whether CRON_SECRET is configured nor chip away at
// the secret via response timing (unconfigured ⇒ 401 for every caller).
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;
  const authorized =
    expected !== null &&
    auth !== null &&
    auth.length === expected.length &&
    timingSafeEqual(Buffer.from(auth, "utf8"), Buffer.from(expected, "utf8"));
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runNightlyPrintBatch();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
