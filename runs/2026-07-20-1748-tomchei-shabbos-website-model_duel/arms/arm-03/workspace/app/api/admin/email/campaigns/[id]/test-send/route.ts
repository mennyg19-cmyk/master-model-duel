import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { createNewsletterToken } from "@/lib/newsletter-token";
import { renderCampaignBody, renderCampaignSubject } from "@/lib/email/campaigns";
import { dispatchOne } from "@/lib/email/dispatch";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { NotificationStatus } from "@/lib/email/notification-lifecycle";

const testSendSchema = z.object({ email: z.string().email().max(254) });

/**
 * Test-send to one address: enqueues under a unique key (never deduped
 * against the real send) and dispatches immediately for instant feedback.
 * Failures are terminal — the production sweeper never retries these (A-05).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("email.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const parsed = testSendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address" }, { status: 400 });

  const campaign = await db.campaign.findUnique({ where: { id } });
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });

  const recipient = { email: parsed.data.email.toLowerCase(), name: "Test Recipient" };
  const token = createNewsletterToken(recipient.email);
  let row;
  try {
    row = await db.notification.create({
      data: {
        channel: "EMAIL",
        recipient: recipient.email,
        kind: "campaign_test",
        subject: `[TEST] ${renderCampaignSubject(campaign.subject, recipient, token)}`,
        body: renderCampaignBody(campaign.body, recipient, token),
        dedupeKey: `campaign-test|${id}|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`,
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
    action: "email.campaign.test_send",
    targetType: "Campaign",
    targetId: id,
    detail: { to: recipient.email, outcome },
  });
  return Response.json({ ok: true, outcome, notificationId: row.id });
}
