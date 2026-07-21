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

  // One grouped query replaces a per-session aggregate (5k-scale cron: a
  // handful of round-trips instead of thousands).
  const postedBySessionKey = new Map<string, { amountCents: number; count: number }>();
  if (sessions.length > 0) {
    const grouped = await db.payment.groupBy({
      by: ["orderId", "stripePaymentIntentId"],
      where: {
        orderId: { in: sessions.map((session) => session.orderId) },
        amountCents: { gt: 0 },
        state: "POSTED",
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
    for (const row of grouped) {
      postedBySessionKey.set(`${row.orderId}|${row.stripePaymentIntentId}`, {
        amountCents: row._sum.amountCents ?? 0,
        count: row._count._all,
      });
    }
  }

  for (const session of sessions) {
    const intentId = session.paymentIntentId ?? `missing_intent_${session.stripeSessionId}`;
    const posted = postedBySessionKey.get(`${session.orderId}|${intentId}`) ?? { amountCents: 0, count: 0 };
    const postedCents = posted.amountCents;

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
    if (posted.count === 0) {
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
  // Batched backing lookup (was two findFirst calls per payment): fetch every
  // session/intent that could back one of these ledger rows in two queries.
  const ledgerIntentIds = stripePayments
    .map((payment) => payment.stripePaymentIntentId)
    .filter((id): id is string => id !== null);
  const backingSessionKeys = new Set<string>();
  const backingIntentIds = new Set<string>();
  if (ledgerIntentIds.length > 0) {
    const backingSessions = await db.stripeCheckoutSession.findMany({
      where: { paymentIntentId: { in: ledgerIntentIds } },
      select: { orderId: true, paymentIntentId: true },
    });
    for (const row of backingSessions) backingSessionKeys.add(`${row.orderId}|${row.paymentIntentId}`);
    const backingIntents = await db.stripePaymentIntent.findMany({
      where: { stripeIntentId: { in: ledgerIntentIds } },
      select: { stripeIntentId: true },
    });
    for (const row of backingIntents) backingIntentIds.add(row.stripeIntentId);
  }

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
      backingSessionKeys.has(`${payment.orderId}|${payment.stripePaymentIntentId}`) ||
      backingIntentIds.has(payment.stripePaymentIntentId);
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
  const existingFlags = findings.length
    ? await db.paymentReconFlag.findMany({ where: { reference: { in: findings.map((finding) => finding.reference) } } })
    : [];
  const existingByReference = new Map(existingFlags.map((flag) => [flag.reference, flag]));
  for (const finding of findings) {
    const existing = existingByReference.get(finding.reference);
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
