import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { BRAND } from "@/lib/brand";
import { captureNotification } from "@/lib/notifications";
import { renderTemplate } from "@/lib/email/templates";

// Campaign engine (R-083, R-085). Sending expands the audience into outbox
// rows deduped on campaign|{id}|{email}, so rerunning send (double click,
// crashed request retried) queues every address exactly once — the DB skips
// collisions and the sweeper delivers each row once (S2: no duplicates).

/** Per-recipient tokens: {{name}}, {{email}}, {{preferencesUrl}}, {{orgName}}. */
function campaignValues(subscriber: { email: string; name: string | null }, token: string) {
  return {
    orgName: BRAND.name,
    name: subscriber.name ?? "friend",
    email: subscriber.email,
    preferencesUrl: `${env.APP_URL}/newsletter/preferences?token=${token}`,
  };
}

export function renderCampaignBody(body: string, subscriber: { email: string; name: string | null }, token: string): string {
  const rendered = renderTemplate(body, campaignValues(subscriber, token));
  // Every campaign email must carry the signed manage/unsubscribe link — append
  // it when the author's body didn't place the token explicitly.
  if (rendered.includes("/newsletter/preferences?token=")) return rendered;
  return `${rendered}\n\nManage your subscription or unsubscribe: ${campaignValues(subscriber, token).preferencesUrl}`;
}

export function renderCampaignSubject(subject: string, subscriber: { email: string; name: string | null }, token: string): string {
  return renderTemplate(subject, campaignValues(subscriber, token));
}

export async function campaignAudience(listId: string | null) {
  return db.newsletterSubscriber.findMany({
    where: {
      status: "SUBSCRIBED",
      ...(listId ? { listMemberships: { some: { listId } } } : {}),
    },
    select: { id: true, email: true, name: true },
    orderBy: { email: "asc" },
  });
}

export type CampaignSendResult = { queued: number; skippedDuplicates: number; audience: number };

/**
 * Queue the campaign to its audience. Safe to call again: already-queued
 * addresses collide on the dedupeKey and are counted as skipped, never re-sent.
 */
export async function sendCampaign(
  campaignId: string,
  mintToken: (email: string) => string
): Promise<CampaignSendResult | { error: string }> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return { error: "Campaign not found" };

  const audience = await campaignAudience(campaign.listId);
  if (audience.length === 0) return { error: "This campaign's audience has no subscribed addresses" };

  let queued = 0;
  for (const subscriber of audience) {
    const token = mintToken(subscriber.email);
    const enqueued = await captureNotification({
      channel: "EMAIL",
      recipient: subscriber.email,
      kind: "campaign",
      subject: renderCampaignSubject(campaign.subject, subscriber, token),
      body: renderCampaignBody(campaign.body, subscriber, token),
      dedupeKey: `campaign|${campaign.id}|${subscriber.email}`,
    });
    if (enqueued) queued += 1;
  }

  await db.campaign.update({
    where: { id: campaignId },
    data: {
      status: "SENT",
      sentAt: campaign.sentAt ?? new Date(),
      queuedCount: campaign.queuedCount + queued,
    },
  });
  return { queued, skippedDuplicates: audience.length - queued, audience: audience.length };
}
