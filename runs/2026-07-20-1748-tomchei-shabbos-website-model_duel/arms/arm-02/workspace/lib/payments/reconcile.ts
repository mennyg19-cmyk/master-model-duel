import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Stripe payment reconciliation matcher (R-093). Compares the Stripe-side
// records we hold (checkout sessions, payment intents) against the posted
// Payment ledger and flags anything that doesn't line up. Findings are
// upserted on a unique reference, so re-running the matcher can never create
// duplicate flags — a rerun refreshes detail on the open flag it already made.
//
// The matcher works on the local ledger (which mirrors Stripe 1:1 through the
// webhook), so it runs identically in mock and live mode. Live mode's extra
// cross-check against Stripe's own list endpoints would slot in here when keys
// exist (logged in DECISION-LOG, not silently guessed).

export type ReconcileSummary = {
  checkedSessions: number;
  checkedPayments: number;
  findings: number;
  newFlags: number;
  openFlags: number;
  byKind: Record<string, number>;
};

type Finding = {
  kind: string;
  reference: string;
  orderId: string | null;
  detail: Prisma.InputJsonObject;
};

export async function runPaymentReconciliation(): Promise<ReconcileSummary> {
  const findings: Finding[] = [];

  // Money-bearing sessions: completed means Stripe captured funds.
  const sessions = await db.stripeCheckoutSession.findMany({
    where: { status: { in: ["completed", "refund_failed"] } },
    include: { order: { select: { id: true, orderNumber: true, totalCents: true, status: true } } },
  });

  for (const session of sessions) {
    const intentId = session.paymentIntentId ?? `missing_intent_${session.stripeSessionId}`;
    const posted = await db.payment.aggregate({
      where: { orderId: session.orderId, stripePaymentIntentId: intentId, amountCents: { gt: 0 }, state: "POSTED" },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
    const postedCents = posted._sum.amountCents ?? 0;

    if (session.status === "refund_failed") {
      findings.push({
        kind: "refund_failed",
        reference: `refund_failed|${session.stripeSessionId}`,
        orderId: session.orderId,
        detail: {
          stripeSessionId: session.stripeSessionId,
          paymentIntentId: intentId,
          amountCents: session.amountCents,
          note: "Auto-refund never reached the gateway — refund manually in the Stripe dashboard",
        },
      });
      continue;
    }
    if (posted._count._all === 0) {
      // Stripe took the money, the ledger has no charge row.
      findings.push({
        kind: "orphaned_payment",
        reference: `orphan|${session.stripeSessionId}`,
        orderId: session.orderId,
        detail: {
          stripeSessionId: session.stripeSessionId,
          paymentIntentId: intentId,
          sessionAmountCents: session.amountCents,
          orderNumber: session.order.orderNumber,
        },
      });
    } else if (postedCents !== session.amountCents) {
      findings.push({
        kind: "amount_mismatch",
        reference: `mismatch|${session.stripeSessionId}`,
        orderId: session.orderId,
        detail: {
          stripeSessionId: session.stripeSessionId,
          sessionAmountCents: session.amountCents,
          postedCents,
          orderNumber: session.order.orderNumber,
        },
      });
    }
  }

  // Ledger rows claiming Stripe money that no session/intent record backs.
  const stripePayments = await db.payment.findMany({
    where: { method: "STRIPE", state: "POSTED", amountCents: { gt: 0 } },
    select: { id: true, orderId: true, amountCents: true, stripePaymentIntentId: true },
  });
  for (const payment of stripePayments) {
    if (!payment.stripePaymentIntentId) {
      findings.push({
        kind: "ledger_only_payment",
        reference: `ledger|${payment.id}`,
        orderId: payment.orderId,
        detail: { paymentId: payment.id, amountCents: payment.amountCents, note: "Stripe payment row with no payment intent id" },
      });
      continue;
    }
    const backed =
      (await db.stripeCheckoutSession.findFirst({
        where: { orderId: payment.orderId, paymentIntentId: payment.stripePaymentIntentId },
        select: { id: true },
      })) ??
      (await db.stripePaymentIntent.findFirst({
        where: { stripeIntentId: payment.stripePaymentIntentId },
        select: { id: true },
      }));
    if (!backed) {
      findings.push({
        kind: "ledger_only_payment",
        reference: `ledger|${payment.id}`,
        orderId: payment.orderId,
        detail: {
          paymentId: payment.id,
          amountCents: payment.amountCents,
          paymentIntentId: payment.stripePaymentIntentId,
          note: "No Stripe session/intent record backs this ledger row",
        },
      });
    }
  }

  // Upsert on the unique reference: reruns refresh, never duplicate. A flag a
  // staff member already resolved stays resolved — the finding is historical.
  let newFlags = 0;
  for (const finding of findings) {
    const existing = await db.paymentReconFlag.findUnique({ where: { reference: finding.reference } });
    if (!existing) {
      await db.paymentReconFlag.create({
        data: { kind: finding.kind, reference: finding.reference, orderId: finding.orderId, detail: finding.detail },
      });
      newFlags += 1;
    } else if (existing.status === "open") {
      await db.paymentReconFlag.update({ where: { id: existing.id }, data: { detail: finding.detail } });
    }
  }

  const byKind: Record<string, number> = {};
  for (const finding of findings) byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;

  return {
    checkedSessions: sessions.length,
    checkedPayments: stripePayments.length,
    findings: findings.length,
    newFlags,
    openFlags: await db.paymentReconFlag.count({ where: { status: "open" } }),
    byKind,
  };
}
