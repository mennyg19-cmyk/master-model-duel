import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { BRAND } from "@/lib/brand";
import { resolveTemplate, renderTemplate } from "@/lib/email/templates";
import { dispatchOne } from "@/lib/email/dispatch";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { NotificationStatus } from "@/lib/email/notification-lifecycle";

const testSchema = z.object({ to: z.string().email().max(254) });

/**
 * Settings test sender (R-090): enqueue + dispatch one email right now and
 * report the outcome. Failures are terminal — sweeper never retries (A-05).
 */
export async function POST(request: Request) {
  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;

  const parsed = testSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address" }, { status: 400 });

  const template = await resolveTemplate("test_email");
  let row;
  try {
    row = await db.notification.create({
      data: {
        channel: "EMAIL",
        recipient: parsed.data.to.toLowerCase(),
        kind: "test_email",
        subject: renderTemplate(template.subject, { orgName: BRAND.name }),
        body: renderTemplate(template.body, { orgName: BRAND.name }),
        dedupeKey: `test-email|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`,
        status: NotificationStatus.SENDING,
        claimedAt: new Date(),
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Response.json({ error: "Could not enqueue test send (dedupe collision)" }, { status: 409 });
    }
    throw error;
  }
  const outcome = await dispatchOne(row);
  await writeAudit(gate.staff, {
    action: "email.test_send",
    targetType: "Notification",
    targetId: row.id,
    detail: { to: row.recipient, outcome },
  });
  const updated = await db.notification.findUniqueOrThrow({ where: { id: row.id } });
  return Response.json({ ok: true, outcome, providerMessageId: updated.providerMessageId, error: updated.lastError });
}
