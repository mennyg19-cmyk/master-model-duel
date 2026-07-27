'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import { saveCampaign, sendCampaign, sendCampaignTest } from '@/lib/email/campaigns';
import { rejectWith } from '@/lib/forms/flash-redirect';

/**
 * The campaign builder's four buttons (R-083).
 *
 * Every one of them checks the permission again, parses the whole form with a
 * named schema and reports back through the URL, the way the settings and
 * catalog actions do — these pages are plain forms with no client state.
 */
const HUB_PATH = '/admin/email';

const campaignFormSchema = z.object({
  campaignId: z.string().trim().optional(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  listId: z.string(),
  preferenceKey: z.string(),
});

const testFormSchema = z.object({
  campaignId: z.string().trim().min(1),
  destination: z.email('Enter an address to send the test to.'),
});

export async function saveCampaignAction(formData: FormData) {
  const context = await requirePermission('email.manage');
  const form = campaignFormSchema.parse(Object.fromEntries(formData));

  const saved = await saveCampaign(form.campaignId || null, form, context.acting.id);
  if (!saved.ok) rejectWith(form.campaignId ? campaignPath(form.campaignId) : HUB_PATH, saved.publicMessage);

  revalidatePath(HUB_PATH);
  redirect(`${campaignPath(saved.value.id)}?notice=${encodeURIComponent('Draft saved.')}`);
}

export async function sendCampaignTestAction(formData: FormData) {
  const context = await requirePermission('email.manage');
  const parsed = testFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) rejectWith(HUB_PATH, parsed.error.issues[0].message);

  const campaign = await db.emailCampaign.findUnique({ where: { id: parsed.data.campaignId } });
  if (!campaign) rejectWith(HUB_PATH, 'That campaign no longer exists.');

  const sent = await sendCampaignTest(campaign, parsed.data.destination);
  const path = campaignPath(campaign.id);
  if (!sent.ok) rejectWith(path, sent.publicMessage);

  await recordAudit(context, {
    action: 'email.test_sent',
    entityType: 'EmailCampaign',
    entityId: campaign.id,
    detail: { destination: parsed.data.destination, provider: sent.value.provider },
  });

  redirect(
    `${path}?notice=${encodeURIComponent(
      sent.value.provider === 'capture'
        ? `Test captured for ${parsed.data.destination}. Nothing left this machine.`
        : `Test sent to ${parsed.data.destination}.`,
    )}`,
  );
}

export async function sendCampaignAction(formData: FormData) {
  const context = await requirePermission('email.manage');
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const path = campaignPath(campaignId);

  const sent = await sendCampaign(campaignId);
  if (!sent.ok) rejectWith(HUB_PATH, sent.publicMessage);

  const recipientCount = await db.emailCampaignSend.count({ where: { campaignId } });
  await recordAudit(context, {
    action: 'email.campaign_sent',
    entityType: 'EmailCampaign',
    entityId: campaignId,
    detail: { queued: sent.value.queued, alreadySent: sent.value.alreadySent, recipientCount },
  });

  revalidatePath(HUB_PATH);
  redirect(
    `${path}?notice=${encodeURIComponent(
      `${sent.value.queued} queued, ${sent.value.alreadySent} already had this letter.`,
    )}`,
  );
}

function campaignPath(campaignId: string): string {
  return `${HUB_PATH}/campaigns/${campaignId}`;
}
