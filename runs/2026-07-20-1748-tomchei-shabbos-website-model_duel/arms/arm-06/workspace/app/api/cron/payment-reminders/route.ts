import { NextResponse } from "next/server";
import { sweepPaymentReminders } from "@/lib/payments/reminders";
import { getOpenSeason } from "@/lib/seasons/queries";
import { cronRoute } from "@/lib/cron-route";

// R-080: the payment-reminder sweep, Vercel Cron (GET + Authorization
// bearer). First reminder once the order is initialAfterDays old, then one
// per intervalDays — lastPaymentReminderAt dedupes, so the cron can run
// hourly without spamming. Every run leaves a CronRun row.
export const dynamic = "force-dynamic";

export const GET = cronRoute(async () => {
  const season = await getOpenSeason();
  if (!season) return NextResponse.json({ error: "No open season" }, { status: 422 });
  return sweepPaymentReminders(season.id);
});
