import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { mapDomainError } from "@/lib/http-errors";
import { sweepPaymentReminders } from "@/lib/payments/reminders";
import { getOpenSeason } from "@/lib/seasons/queries";

export const dynamic = "force-dynamic";

// R-080: the payment-reminder sweep, Vercel Cron (GET + Authorization
// bearer). First reminder once the order is initialAfterDays old, then one
// per intervalDays — lastPaymentReminderAt dedupes, so the cron can run
// hourly without spamming. Every run leaves a CronRun row.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const season = await getOpenSeason();
  if (!season) return NextResponse.json({ error: "No open season" }, { status: 422 });

  try {
    const result = await sweepPaymentReminders(season.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
