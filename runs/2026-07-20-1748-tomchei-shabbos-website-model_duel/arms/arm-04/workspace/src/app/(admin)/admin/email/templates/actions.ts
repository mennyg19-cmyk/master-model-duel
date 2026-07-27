'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import { isTriggeredTemplateKey, unknownPlaceholders } from '@/lib/email/templates';
import { rejectWith } from '@/lib/forms/flash-redirect';

const TEMPLATES_PATH = '/admin/email/templates';

const templateSchema = z.object({
  key: z.string().refine(isTriggeredTemplateKey, 'That is not an email this app sends.'),
  subject: z.string().trim().min(1, 'An email needs a subject line.').max(160),
  body: z.string().trim().min(1, 'There is nothing to send yet.').max(20_000),
  isEnabled: z.boolean(),
});

export async function saveTemplateAction(formData: FormData) {
  const context = await requirePermission('email.manage');

  const parsed = templateSchema.safeParse({
    key: formData.get('key'),
    subject: formData.get('subject'),
    body: formData.get('body'),
    isEnabled: formData.get('isEnabled') === 'on',
  });
  if (!parsed.success) rejectWith(TEMPLATES_PATH, parsed.error.issues[0].message);

  const { key, subject, body, isEnabled } = parsed.data;

  // A misspelt placeholder is silently printed as `{{custmerName}}` in a real
  // customer's inbox, so it is caught here rather than in the outbox.
  const unknown = unknownPlaceholders(key, `${subject}\n${body}`);
  if (unknown.length > 0) {
    rejectWith(
      TEMPLATES_PATH,
      `This email has nothing to put in ${unknown.map((name) => `{{${name}}}`).join(', ')}. Use only the fields listed under the box.`,
    );
  }

  await db.emailTemplate.upsert({
    where: { key },
    create: { key, subject, body, isEnabled, updatedByStaffUserId: context.actor.id },
    update: { subject, body, isEnabled, updatedByStaffUserId: context.actor.id },
  });

  await recordAudit(context, {
    action: 'email.template_saved',
    entityType: 'EmailTemplate',
    entityId: key,
    detail: { key, isEnabled },
  });

  revalidatePath(TEMPLATES_PATH);
  redirect(`${TEMPLATES_PATH}?notice=${encodeURIComponent('Saved. New emails use these words.')}`);
}

export async function resetTemplateAction(formData: FormData) {
  const context = await requirePermission('email.manage');
  const key = String(formData.get('key') ?? '');
  if (!isTriggeredTemplateKey(key)) rejectWith(TEMPLATES_PATH, 'That is not an email this app sends.');

  await db.emailTemplate.deleteMany({ where: { key } });
  await recordAudit(context, {
    action: 'email.template_saved',
    entityType: 'EmailTemplate',
    entityId: key,
    detail: { key, isEnabled: true },
  });

  revalidatePath(TEMPLATES_PATH);
  redirect(`${TEMPLATES_PATH}?notice=${encodeURIComponent('Back to the wording it shipped with.')}`);
}
