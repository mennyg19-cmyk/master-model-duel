import { db } from "@/lib/db";
import { requireCronAuth, runCronJob } from "@/lib/cron";
import { getSetting } from "@/lib/settings";
import { NotificationStatus } from "@/lib/email/notification-lifecycle";

const MIN_RETENTION_DAYS = 7;

/**
 * Email-log purge cron (R-172): deletes notification rows that finished
 * (sent / captured / failed) longer ago than the retention window, anchored on
 * the terminal event (updatedAt), not createdAt — a row that sat pending past
 * retention and finished today keeps its trail for a full window. Rows still
 * pending or sending are the live outbox and are never touched; attempt logs
 * cascade with their notification. AuditLog is a different table — untouched.
 */
export async function POST(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const result = await runCronJob("email-log-purge", async () => {
    const configured = await getSetting("email.log_retention_days");
    const retentionDays = Math.max(configured, MIN_RETENTION_DAYS);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const purged = await db.notification.deleteMany({
      where: {
        status: {
          in: [NotificationStatus.SENT, NotificationStatus.CAPTURED, NotificationStatus.FAILED],
        },
        updatedAt: { lt: cutoff },
      },
    });
    return { retentionDays, purged: purged.count };
  });
  return Response.json({ ok: true, ...result });
}

// Vercel cron invokes with GET (R-185); same bearer-authed handler either way.
export { POST as GET };
