import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { createNewsletterToken } from "@/lib/newsletter-token";
import { renderCampaignBody, renderCampaignSubject } from "@/lib/email/campaigns";
import { dispatchOne } from "@/lib/email/dispatch";

const testSendSchema = z.object({ email: z.string().email().max(254) });

/**
 * Test-send to one address: enqueues under a unique key (never deduped
 * against the real send) and dispatches immediately for instant feedback.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("email.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const parsed = testSendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address" }, { status: 400 });

  const campaign = await db.campaign.findUnique({ where: { id } });
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });

  // Neutral display name: the body goes to an external address, so it must not
  // carry the staff member's real name.
  const recipient = { email: parsed.data.email.toLowerCase(), name: "Test Recipient" };
  const token = createNewsletterToken(recipient.email);
  const row = await db.notification.create({
    data: {
      channel: "EMAIL",
      recipient: recipient.email,
      kind: "campaign_test",
      subject: `[TEST] ${renderCampaignSubject(campaign.subject, recipient, token)}`,
      body: renderCampaignBody(campaign.body, recipient, token),
      dedupeKey: `campaign-test|${id}|${Date.now()}`,
      status: "sending",
      claimedAt: new Date(),
    },
  });
  const outcome = await dispatchOne(row);
  await writeAudit(gate.staff, {
    action: "email.campaign.test_send",
    targetType: "Campaign",
    targetId: id,
    detail: { to: recipient.email, outcome },
  });
  return Response.json({ ok: true, outcome, notificationId: row.id });
}
