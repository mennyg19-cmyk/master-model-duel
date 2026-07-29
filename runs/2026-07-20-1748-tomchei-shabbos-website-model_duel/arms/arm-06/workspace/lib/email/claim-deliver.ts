import { OutboxMessage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError } from "@/lib/errors";
import { MILLIS_PER_MINUTE } from "@/lib/dates";
import { getSetting } from "@/lib/settings";
import { deliverMessage } from "@/lib/email/dispatch";
import { EmailBranding } from "@/lib/email/render";

// The one-claim law every outbox consumer shares (S4): the sweeper, the
// campaign loop, and the test-send paths all take ownership of a row through
// the same atomic conditional UPDATE, so overlapping owners can never deliver
// twice. Two branches:
//   fresh — PENDING, or FAILED under the retry cap: the claim spends one
//     attempt up front, re-checked atomically so concurrent claimers can
//     never push attempts past the cap.
//   stale — SENDING with an old claim clock (crashed owner): recovered
//     WITHOUT spending an attempt, because a crash is not a provider failure
//     and must not eat the retry budget.
export const STALE_CLAIM_MS = 10 * MILLIS_PER_MINUTE;

export async function claimOutboxRow(id: string, maxAttempts: number, staleBefore: Date): Promise<boolean> {
  const fresh = await prisma.outboxMessage.updateMany({
    where: { id, OR: [{ status: "PENDING" }, { status: "FAILED", attempts: { lt: maxAttempts } }] },
    data: { status: "SENDING", attempts: { increment: 1 }, lastAttemptAt: new Date() },
  });
  if (fresh.count > 0) return true;
  const stale = await prisma.outboxMessage.updateMany({
    where: { id, status: "SENDING", lastAttemptAt: { lt: staleBefore } },
    data: { lastAttemptAt: new Date() },
  });
  return stale.count > 0;
}

export type RowDelivery =
  | { outcome: "sent"; providerId: string; captured: boolean }
  | { outcome: "failed"; lastError: string };

// Delivers a row the caller has just claimed, records the outcome, and (for
// campaign deliveries) mirrors the result onto the recipient ledger row.
export async function deliverClaimedRow(id: string, branding?: EmailBranding): Promise<RowDelivery> {
  const message = await prisma.outboxMessage.findUniqueOrThrow({ where: { id } });
  try {
    const outcome = await deliverMessage(message, branding);
    const updated = await prisma.outboxMessage.update({
      where: { id },
      data: { status: "SENT", providerId: outcome.providerId, sentAt: new Date(), lastError: null },
    });
    await mirrorRecipientFromOutboxRow(updated);
    return { outcome: "sent", providerId: outcome.providerId, captured: outcome.captured };
  } catch (error) {
    const lastError = error instanceof Error ? error.message : String(error);
    const updated = await prisma.outboxMessage.update({
      where: { id },
      data: { status: "FAILED", lastError },
    });
    await mirrorRecipientFromOutboxRow(updated);
    return { outcome: "failed", lastError };
  }
}

// The campaign recipient row mirrors its delivery outbox row, so the
// recipient ledger (status/attempts/provider) stays provable no matter which
// consumer (campaign loop, sweeper) drove the delivery.
export async function mirrorRecipientFromOutboxRow(row: OutboxMessage): Promise<void> {
  if (!row.campaignRecipientId) return;
  if (row.status === "SENT") {
    await prisma.emailCampaignRecipient.update({
      where: { id: row.campaignRecipientId },
      data: { status: "SENT", providerId: row.providerId, sentAt: row.sentAt, lastError: null, attempts: row.attempts, lastAttemptAt: row.lastAttemptAt },
    });
  } else if (row.status === "FAILED") {
    await prisma.emailCampaignRecipient.update({
      where: { id: row.campaignRecipientId },
      data: { status: "FAILED", lastError: row.lastError, attempts: row.attempts, lastAttemptAt: row.lastAttemptAt },
    });
  }
}

// The test-send contract the hub clients render (M11): `error` carries the
// failure reason, null on success — one shape for campaign test-send and the
// settings test sender.
export interface DispatchOnceResult {
  outboxId: string;
  delivered: boolean;
  providerId: string | null;
  error: string | null;
}

// Test-send discipline (M7): create the outbox row, then CLAIM it before the
// inline dispatch — the sweeper can never race a test send into a double
// delivery. If the sweeper won the claim anyway, report the row honestly
// instead of clobbering the owner's state.
export async function dispatchOnce(rowId: string, branding?: EmailBranding): Promise<DispatchOnceResult> {
  const policy = await getSetting("email.policy");
  if (!policy) {
    throw new DomainRuleError("email.policy is not configured; expected the seeded retention/retry policy before sending");
  }
  const claimed = await claimOutboxRow(rowId, policy.maxAttempts, new Date(Date.now() - STALE_CLAIM_MS));
  if (!claimed) {
    const current = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: rowId } });
    return {
      outboxId: rowId,
      delivered: current.status === "SENT",
      providerId: current.providerId,
      error: current.status === "SENT" ? null : "the outbox sweeper claimed this send; it delivers on its own pass",
    };
  }
  const delivery = await deliverClaimedRow(rowId, branding);
  if (delivery.outcome === "sent") {
    return { outboxId: rowId, delivered: true, providerId: delivery.providerId, error: null };
  }
  return { outboxId: rowId, delivered: false, providerId: null, error: delivery.lastError };
}
