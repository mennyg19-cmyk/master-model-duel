import { requireCronAuth, runCronJob } from "@/lib/cron";
import { sweepNotificationOutbox } from "@/lib/email/dispatch";

/**
 * Outbox sweeper cron (R-088, R-181): delivers due pending notifications and
 * retries failures with backoff. Overlapping runs are safe — each row is
 * claimed by a conditional UPDATE, so exactly one sweep sends it (S4).
 */
export async function POST(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const result = await runCronJob("notification-sweeper", () => sweepNotificationOutbox());
  return Response.json({ ok: true, ...result });
}
