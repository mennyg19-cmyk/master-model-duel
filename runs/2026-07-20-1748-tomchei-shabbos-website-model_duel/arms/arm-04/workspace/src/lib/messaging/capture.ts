import 'server-only';

import type { NotificationChannel } from '@prisma/client';

import { db } from '../db';
import { MessageProviderError, type MessageProvider, type OutgoingMessage } from './provider';

/**
 * Test mode (R-178, R-014).
 *
 * Every message is written to `CapturedMessage` and nothing leaves the
 * machine, so development, CI and the settings test sender run the real
 * templates, the real queue and the real sweeper against a table anyone can
 * read. Env validation refuses this provider off a loopback address, because a
 * deployment that captures its mail looks healthy and tells nobody anything.
 */
export const CAPTURE_SOURCES = {
  outbox: 'outbox',
  settingsTest: 'settings-test',
  campaignTest: 'campaign-test',
} as const;

export type CaptureSource = (typeof CAPTURE_SOURCES)[keyof typeof CAPTURE_SOURCES];

/**
 * The address that always fails.
 *
 * A retry rule nobody has watched work is a retry rule nobody should trust, and
 * the only way to watch it is to have a destination the provider refuses. Any
 * address or number starting with this word is turned down the way a real
 * provider turns down a bad recipient, so the sweeper's backoff, the give-up
 * rule and the failure trail are exercised in development, in CI and in the
 * phase smoke run.
 */
export const CAPTURE_REFUSED_PREFIX = 'bounce';

export function createCaptureProvider(channel: NotificationChannel): MessageProvider {
  return {
    name: 'capture',
    async send(message: OutgoingMessage) {
      if (message.destination.trim().toLowerCase().startsWith(CAPTURE_REFUSED_PREFIX)) {
        throw new MessageProviderError('capture', 422);
      }

      const captured = await captureMessage(channel, message, CAPTURE_SOURCES.outbox);
      return { providerReference: captured.id };
    },
  };
}

export async function captureMessage(
  channel: NotificationChannel,
  message: Pick<OutgoingMessage, 'destination' | 'subject' | 'body'>,
  source: CaptureSource,
) {
  return db.capturedMessage.create({
    data: {
      channel,
      destination: message.destination,
      subject: message.subject,
      body: message.body,
      source,
    },
  });
}
