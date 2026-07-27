import 'server-only';

import { env } from '../env';
import { createCaptureProvider } from '../messaging/capture';
import type { MessageProvider } from '../messaging/provider';
import { createResendProvider } from './resend-api';

let provider: MessageProvider | null = null;

/**
 * Built on first use and kept, the same way the payment gateway and the
 * shipping provider are: importing something from this folder must not require
 * a mail account to be configured.
 */
export function getEmailProvider(): MessageProvider {
  provider ??= env.EMAIL_PROVIDER === 'resend' ? createResendProvider() : createCaptureProvider('EMAIL');
  return provider;
}

/** True when nothing this app sends can reach a real inbox. */
export function isEmailCaptured(): boolean {
  return env.EMAIL_PROVIDER === 'capture';
}
