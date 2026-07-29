import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { mapDomainError } from "@/lib/http-errors";
import { purgeEmailLog } from "@/lib/email/purge";

export const dynamic = "force-dynamic";

// R-172: the email-log purge, Vercel Cron (GET + bearer). Deletes SENT outbox
// rows and SENT/SKIPPED campaign recipients past email.policy.retentionDays;
// active outbox rows (PENDING/SENDING), the FAILED failure trail, and all
// audit evidence are never eligible. Every run leaves a CronRun row.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await purgeEmailLog();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
