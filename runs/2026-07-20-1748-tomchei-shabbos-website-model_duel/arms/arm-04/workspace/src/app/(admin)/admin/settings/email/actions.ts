'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { auditSettingChange, firstMessage, wholeNumber } from '@/lib/admin/settings-form';
import { requirePermission } from '@/lib/auth/staff';
import { sendOneOffEmail } from '@/lib/email/one-off';
import { rejectWith } from '@/lib/forms/flash-redirect';
import { CAPTURE_SOURCES } from '@/lib/messaging/capture';
import { writeSetting } from '@/lib/settings';

/**
 * Who email comes from, what it looks like, and the button that proves both
 * (R-085, R-090).
 *
 * These live next to the page that submits them rather than in the settings
 * hub's own action file: the hub already carried seven unrelated settings
 * domains, and email is the one with schemas, a provider and a send of its own.
 */
const EMAIL_PATH = '/admin/settings/email';

/** Blank means "not set yet", which is different from a name nobody can read. */
const senderAddress = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || z.email().safeParse(value).success,
    'Sender addresses have to be email addresses, or blank.',
  );

const emailSenderSchema = z.object({
  fromName: z
    .string()
    .trim()
    .min(1, 'Email has to come from a name, so recipients know who wrote.')
    .max(80, 'Keep the sender name to 80 characters or fewer.'),
  fromAddress: senderAddress,
  replyToAddress: senderAddress,
});

const LOGO_MESSAGE = 'The logo has to be a full https:// address, or blank.';

/**
 * The logo is written into an `<img src>` in every email this app sends. The
 * markup is escaped, so the attribute cannot be broken out of — but `javascript:`
 * and `data:` are URLs the browser will happily run, and an email client is a
 * browser. Only the two schemes that fetch a picture are allowed, the same
 * allowlist the body links get.
 */
function isFetchableUrl(candidate: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(candidate).protocol);
  } catch {
    return false;
  }
}

const RETENTION_MESSAGE = 'Keep delivered email between 7 and 730 days.';
const emailBrandingSchema = z.object({
  logoUrl: z
    .string()
    .trim()
    .refine((value) => value === '' || isFetchableUrl(value), LOGO_MESSAGE),
  footerText: z.string().trim().max(280, 'Keep the footer to 280 characters or fewer.'),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #8a1c1c.'),
  logRetentionDays: wholeNumber(RETENTION_MESSAGE).refine(
    (days) => days >= 7 && days <= 730,
    RETENTION_MESSAGE,
  ),
});

export async function saveEmailSettingsAction(formData: FormData) {
  const context = await requirePermission('settings.manage');
  const parsed = emailSenderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) rejectWith(EMAIL_PATH, firstMessage(parsed.error));

  await writeSetting('email.fromName', parsed.data.fromName);
  await writeSetting('email.fromAddress', parsed.data.fromAddress);
  await writeSetting('email.replyToAddress', parsed.data.replyToAddress);
  await auditSettingChange(context, 'email', `sender ${parsed.data.fromAddress || 'unset'}`);

  revalidatePath(EMAIL_PATH);
}

export async function saveEmailBrandingAction(formData: FormData) {
  const context = await requirePermission('settings.manage');
  const parsed = emailBrandingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) rejectWith(EMAIL_PATH, firstMessage(parsed.error));

  await writeSetting('email.logoUrl', parsed.data.logoUrl);
  await writeSetting('email.footerText', parsed.data.footerText);
  await writeSetting('email.accentColor', parsed.data.accentColor);
  await writeSetting('email.logRetentionDays', parsed.data.logRetentionDays);
  await auditSettingChange(
    context,
    'email.branding',
    `${parsed.data.logRetentionDays} day retention`,
  );

  revalidatePath(EMAIL_PATH);
}

/**
 * "Does email work from this machine?" answered in one click (R-090).
 *
 * It goes straight out rather than through the outbox: the point is to prove
 * the provider and the sender address, and a queued row would only prove that
 * the database accepts writes.
 */
export async function sendTestEmailAction(formData: FormData) {
  const context = await requirePermission('settings.manage');
  const destination = z
    .email('Enter an address to send the test to.')
    .safeParse(formData.get('destination'));
  if (!destination.success) rejectWith(EMAIL_PATH, firstMessage(destination.error));

  const sent = await sendOneOffEmail({
    destination: destination.data,
    subject: 'Test email from the Tomchei Shabbos site',
    body:
      'This is a test.\n\n' +
      'If it reached you, the sender address and the mail provider are both working, and ' +
      'the letterhead around these words is the one every email will wear.',
    source: CAPTURE_SOURCES.settingsTest,
  });
  if (!sent.ok) rejectWith(EMAIL_PATH, sent.publicMessage);

  await recordAudit(context, {
    action: 'email.test_sent',
    entityType: 'Setting',
    entityId: 'email.fromAddress',
    detail: { destination: destination.data, provider: sent.value.provider },
  });

  redirect(
    `${EMAIL_PATH}?notice=${encodeURIComponent(
      sent.value.provider === 'capture'
        ? `Captured for ${destination.data}. EMAIL_PROVIDER is set to capture, so nothing left this machine and nothing was queued.`
        : `Sent to ${destination.data}.`,
    )}`,
  );
}
