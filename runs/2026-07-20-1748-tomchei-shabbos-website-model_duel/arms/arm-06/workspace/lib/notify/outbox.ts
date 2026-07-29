import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { TriggeredKey } from "@/lib/email/triggered";

// P9 notification seam (G-021). No live Resend/Twilio keys exist on this host
// — the email platform and the SMS provider decision land in P11 (merged plan
// open question #1). Every send is captured as an OutboxMessage row, which is
// exactly the shape the P11 outbox/sweepers will drain; the dev read route
// (/api/dev/outbox) is the test-capture double, same honesty class as the P5
// Stripe fixture and the P8 Shippo double.
//
// Channel policy (phase-plan decision 7): time-sensitive operational notices
// (day-of route start, bulk schedule, pickup ready) go email + SMS when the
// customer has a phone; follow-ups (pickup expired, payment reminder) are
// email-only.

export type NotificationKind =
  | "day_of_delivery"
  | "bulk_scheduled"
  | "pickup_ready"
  | "pickup_expired"
  | "payment_reminder";

export type NotificationChannel = "EMAIL" | "SMS";

// The full OutboxMessage kind vocabulary: the P9 notification kinds above,
// the P11 triggered keys, and the campaign/test kinds. The column stays
// String (test fixtures write synthetic kinds), so producers reference these
// unions — a typo at a write site is a compile error, not a row no reader
// understands. Test kinds are one-shot probes: the sweeper never retries
// them after a failure (the operator re-sends explicitly).
export const CAMPAIGN_OUTBOX_KIND = "campaign";
export const TEST_OUTBOX_KINDS = ["campaign_test", "test_email"] as const;
export type CampaignOutboxKind = typeof CAMPAIGN_OUTBOX_KIND | (typeof TEST_OUTBOX_KINDS)[number];
export type OutboxKind = NotificationKind | TriggeredKey | CampaignOutboxKind;

export const NOTIFY_CHANNELS: Record<NotificationKind, readonly NotificationChannel[]> = {
  day_of_delivery: ["EMAIL", "SMS"],
  bulk_scheduled: ["EMAIL", "SMS"],
  pickup_ready: ["EMAIL", "SMS"],
  pickup_expired: ["EMAIL"],
  payment_reminder: ["EMAIL"],
};

export interface NotifyRecipient {
  email: string;
  phone?: string | null;
}

export interface NotifyInput {
  kind: NotificationKind;
  recipient: NotifyRecipient;
  subject: string;
  // Email body; SMS gets smsBody (kept short) or falls back to body.
  body: string;
  smsBody?: string;
  orderId?: string;
  metadata?: Prisma.InputJsonValue;
}

// Writes one outbox row per configured channel the recipient can take (SMS
// requires a phone). Returns the channel list actually written so callers can
// assert "one email + one SMS per customer".
export async function sendNotification(
  input: NotifyInput,
  tx?: Prisma.TransactionClient,
): Promise<NotificationChannel[]> {
  const client = tx ?? prisma;
  const channels = NOTIFY_CHANNELS[input.kind].filter(
    (channel) => channel === "EMAIL" || (input.recipient.phone ?? "").trim().length > 0,
  );
  for (const channel of channels) {
    await client.outboxMessage.create({
      data: {
        kind: input.kind,
        channel,
        toAddress: channel === "EMAIL" ? input.recipient.email : input.recipient.phone!.trim(),
        subject: channel === "EMAIL" ? input.subject : null,
        body: channel === "SMS" ? (input.smsBody ?? input.body) : input.body,
        orderId: input.orderId ?? null,
        metadata: input.metadata ?? Prisma.DbNull,
      },
    });
  }
  return channels;
}
