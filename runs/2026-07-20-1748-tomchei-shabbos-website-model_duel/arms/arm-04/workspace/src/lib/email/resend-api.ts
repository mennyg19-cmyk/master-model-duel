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
 * The only file in the app that knows what Resend's API looks like (R-171).
 *
 * It is `fetch` rather than the `resend` npm package because one POST with a
 * bearer token is the whole integration: a dependency would add a build to
 * audit and an upgrade to track for four lines of JSON. Everything Resend
 * specific — the URL, the field names, the idempotency header, the shape of
 * the reply — stops here, so swapping mail providers is one new file and one
 * line in `provider.ts`.
 */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function createResendProvider(): MessageProvider {
  return {
    name: 'resend',
    async send(message: OutgoingMessage) {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY ?? ''}`,
          'content-type': 'application/json',
          'idempotency-key': message.idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify(requestBody(message)),
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) throw new MessageProviderError('resend', response.status);

      const accepted: unknown = await response.json();
      return { providerReference: extractProviderReference(accepted, 'id', 'Resend') };
    },
  };
}

function requestBody(message: OutgoingMessage) {
  return {
    from: message.sender ?? '',
    to: [message.destination],
    subject: message.subject ?? '',
    text: message.body,
    ...(message.html ? { html: message.html } : {}),
    ...(message.replyTo ? { reply_to: [message.replyTo] } : {}),
  };
}