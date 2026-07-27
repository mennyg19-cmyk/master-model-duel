import 'server-only';

import { failure, ok, type Result } from '../core/result';
import { captureMessage, type CaptureSource } from '../messaging/capture';
import { readEmailBranding, renderBrandedHtml, senderLine } from './branding';
import { getEmailProvider, isEmailCaptured } from './provider';

export const EMAIL_NO_SENDER = 'email_no_sender';

/**
 * An email sent on the spot rather than queued: the settings test sender
 * (R-090) and a campaign's test send (R-083).
 *
 * These two are the exceptions to "everything goes through the outbox", and
 * deliberately so — the person pressing the button is waiting to find out
 * whether mail works, and an answer that means "it is in a queue somewhere"
 * would not tell them. Nothing else in the app sends this way.
 */
export async function sendOneOffEmail(input: {
  destination: string;
  subject: string;
  body: string;
  source: CaptureSource;
}): Promise<Result<{ provider: string }>> {
  const branding = await readEmailBranding();
  const sender = senderLine(branding);
  if (!sender) {
    return failure(
      EMAIL_NO_SENDER,
      'Set the sender address on Settings → Email before sending anything.',
    );
  }

  // Test mode files the message under what asked for it, rather than letting
  // the provider record it as outbox traffic it never was.
  if (isEmailCaptured()) {
    await captureMessage('EMAIL', input, input.source);
    return ok({ provider: 'capture' });
  }

  await getEmailProvider().send({
    destination: input.destination,
    subject: input.subject,
    body: input.body,
    html: renderBrandedHtml(branding, { subject: input.subject, body: input.body }),
    sender,
    replyTo: branding.replyToAddress || null,
    idempotencyKey: `${input.source}:${input.destination}:${Date.now()}`,
  });

  return ok({ provider: getEmailProvider().name });
}
