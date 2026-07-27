import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { BRAND } from "@/lib/brand";
import { resolveTemplate, renderTemplate } from "@/lib/email/templates";
import { dispatchOne } from "@/lib/email/dispatch";

const testSchema = z.object({ to: z.string().email().max(254) });

/**
 * Settings test sender (R-090): enqueue + dispatch one email right now and
 * report the outcome (sent / captured / retried / failed) to the staff member.
 */
export async function POST(request: Request) {
  const gate = await requirePermissionApi("settings.manage");
  if ("response" in gate) return gate.response;

  const parsed = testSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address" }, { status: 400 });

  const template = await resolveTemplate("test_email");
  const row = await db.notification.create({
    data: {
      channel: "EMAIL",
      recipient: parsed.data.to.toLowerCase(),
      kind: "test_email",
      subject: renderTemplate(template.subject, { orgName: BRAND.name }),
      body: renderTemplate(template.body, { orgName: BRAND.name }),
      dedupeKey: `test-email|${Date.now()}`,
      status: "sending",
      claimedAt: new Date(),
    },
  });
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
