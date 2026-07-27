import 'server-only';

import { env } from '../env';
import { createCaptureProvider } from '../messaging/capture';
import type { MessageProvider } from '../messaging/provider';
import { createTwilioProvider } from './twilio-api';

let provider: MessageProvider | null = null;

/**
 * The SMS half of the notification channel P9 already writes to (G-021).
 *
 * P9 queues an email and a text per customer event; this is what carries the
 * text. It is selected and cached the same way the mail provider is, so the
 * sweeper asks one question — "which provider does this row's channel use" —
 * and never has two code paths.
 */
export function getSmsProvider(): MessageProvider {
  provider ??= env.SMS_PROVIDER === 'twilio' ? createTwilioProvider() : createCaptureProvider('SMS');
  return provider;
}
