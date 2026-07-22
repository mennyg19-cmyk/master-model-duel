/** Shared outbox lifecycle literals (A-11) — one map, no free-form drift. */

export const NotificationStatus = {
  PENDING: "pending",
  SENDING: "sending",
  SENT: "sent",
  FAILED: "failed",
  CAPTURED: "captured",
} as const;

export type NotificationStatusValue = (typeof NotificationStatus)[keyof typeof NotificationStatus];

export const AttemptOutcome = {
  SENT: "sent",
  FAILED: "failed",
  CAPTURED: "captured",
} as const;

export type AttemptOutcomeValue = (typeof AttemptOutcome)[keyof typeof AttemptOutcome];

/** Staff test-send kinds: never ride the production sweeper / retry loop (A-05). */
export const TEST_NOTIFICATION_KINDS = ["test_email", "campaign_test"] as const;

export function isTestNotificationKind(kind: string): boolean {
  return (TEST_NOTIFICATION_KINDS as readonly string[]).includes(kind);
}
