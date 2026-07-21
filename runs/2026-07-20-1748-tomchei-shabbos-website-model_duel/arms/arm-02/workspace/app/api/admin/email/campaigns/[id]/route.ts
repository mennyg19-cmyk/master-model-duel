import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { createNewsletterToken } from "@/lib/newsletter-token";
import { campaignAudience, renderCampaignBody, renderCampaignSubject } from "@/lib/email/campaigns";

/** Detail + preview: the campaign rendered as its first audience member sees it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("email.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const campaign = await db.campaign.findUnique({ where: { id }, include: { list: { select: { name: true } } } });
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });

  const audience = await campaignAudience(campaign.listId);
  const sample = audience[0] ?? { email: "subscriber@example.com", name: "Sample Subscriber" };
  const token = createNewsletterToken(sample.email);
  return Response.json({
    campaign,
    audienceCount: audience.length,
    preview: {
      to: sample.email,
      subject: renderCampaignSubject(campaign.subject, sample, token),
      body: renderCampaignBody(campaign.body, sample, token),
    },
  });
}

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(300).optional(),
  body: z.string().min(1).max(50_000).optional(),
  listId: z.string().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("email.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const campaign = await db.campaign.findUnique({ where: { id } });
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.status === "SENT") {
    return Response.json({ error: "A sent campaign can no longer be edited" }, { status: 409 });
  }
  await db.campaign.update({ where: { id }, data: parsed.data });
  await writeAudit(gate.staff, { action: "email.campaign.update", targetType: "Campaign", targetId: id });
  return Response.json({ ok: true });
}
