import 'server-only';

import { env } from '../env';
import {
  extractProviderReference,
  MessageProviderError,
  PROVIDER_REQUEST_TIMEOUT_MS,
  type MessageProvider,
  type OutgoingMessage,
} from '../messaging/provider';

/**
 * The only file that knows what Twilio's API looks like (G-021).
 *
 * Same shape as the mail provider next door and for the same reason: one
 * form-encoded POST behind basic auth is the whole integration, and keeping
 * the carrier's vocabulary in one file is what makes "swap the SMS provider"
 * a one-file change. The stack choice itself is the plan's one open item, so
 * this is deliberately the thinnest thing that works.
 */
const TWILIO_API_ROOT = 'https://api.twilio.com/2010-04-01/Accounts';

export function createTwilioProvider(): MessageProvider {
  return {
    name: 'twilio',
    async send(message: OutgoingMessage) {
      const accountSid = env.TWILIO_ACCOUNT_SID ?? '';
      const response = await fetch(`${TWILIO_API_ROOT}/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          authorization: basicAuth(accountSid, env.TWILIO_AUTH_TOKEN ?? ''),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: message.destination,
          From: env.TWILIO_FROM_NUMBER ?? '',
          Body: message.body,
        }),
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) throw new MessageProviderError('twilio', response.status);

      const accepted: unknown = await response.json();
      return { providerReference: extractProviderReference(accepted, 'sid', 'Twilio') };
    },
  };
}

function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}
