import { AuditAction, NotifyStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  defaultFromAddress,
  getEmailMode,
  resendSend,
} from "@/lib/resend/client";
import { writeEmailLog } from "@/lib/notify/outbox";
import { NotifyChannel } from "@prisma/client";
import { getSetting } from "@/lib/settings";
import { STORE_SETTINGS } from "@/lib/storefront/settings-keys";
import { err, ok, type Result } from "@/lib/result";

/** Purge eligible email logs without touching active outbox or audit (R-172). */
export async function purgeEmailLogs(input?: { now?: Date }) {
  const now = input?.now ?? new Date();
  const activeOutbox = await db.notificationOutbox.findMany({
    where: {
      status: { in: [NotifyStatus.PENDING, NotifyStatus.CLAIMED, NotifyStatus.FAILED] },
    },
    select: { id: true },
  });
  const activeIds = new Set(activeOutbox.map((r) => r.id));

  const eligible = await db.emailLog.findMany({
    where: { purgeAfter: { lte: now } },
    take: 500,
  });

  const toDelete = eligible.filter(
    (log) => !log.outboxId || !activeIds.has(log.outboxId),
  );
  const ids = toDelete.map((l) => l.id);
  if (ids.length) {
    await db.emailLog.deleteMany({ where: { id: { in: ids } } });
  }

  await writeAudit({
    action: AuditAction.EMAIL_LOG_PURGED,
    meta: {
      deleted: ids.length,
      skippedActive: eligible.length - ids.length,
      at: now.toISOString(),
    },
  });

  return {
    scanned: eligible.length,
    deleted: ids.length,
    skippedActive: eligible.length - ids.length,
  };
}

export async function sendTestEmail(input: {
  to: string;
  subject?: string;
  body?: string;
  actorId?: string | null;
}): Promise<Result<{ captured: boolean; providerId?: string }>> {
  const to = input.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return err("bad_email", "Enter a valid email address.");
  }
  const subject = input.subject?.trim() || "Tomchei test email";
  const body =
    input.body?.trim() ||
    "<p>This is a test email from settings (R-090).</p>";

  const mode = getEmailMode();
  if (mode === "capture") {
    await writeEmailLog({
      channel: NotifyChannel.EMAIL,
      templateKey: "settings.test",
      recipientKey: to,
      subject,
      body,
      status: "captured",
    });
    await writeAudit({
      action: AuditAction.EMAIL_TEST_SENT,
      actorId: input.actorId,
      meta: { to, captured: true },
    });
    return ok({ captured: true });
  }

  const fromSetting = await getSetting<{ address?: string }>(STORE_SETTINGS.emailFrom);
  const from = fromSetting?.address?.trim() || defaultFromAddress();
  const result = await resendSend({ to, from, subject, html: body });
  if (!result.ok) return err("send", result.error || "Test send failed.");

  await writeEmailLog({
    channel: NotifyChannel.EMAIL,
    templateKey: "settings.test",
    recipientKey: to,
    subject,
    body,
    status: result.captured ? "captured" : "sent",
    providerId: result.providerId,
  });
  await writeAudit({
    action: AuditAction.EMAIL_TEST_SENT,
    actorId: input.actorId,
    meta: { to, providerId: result.providerId, captured: Boolean(result.captured) },
  });
  return ok({ captured: Boolean(result.captured), providerId: result.providerId });
}
