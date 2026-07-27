import 'server-only';

import type { ReconciliationFlagKind } from '@prisma/client';

import { runCronJobBody } from '../cron/job-run';
import { db } from '../db';

/**
 * Does the ledger agree with the gateway (R-093)?
 *
 * Three ways it can disagree, and each is a different kind of trouble:
 *
 * - **Orphaned intent.** The gateway took the money and no `Payment` row was
 *   ever written — a webhook that never arrived. Somebody paid and their order
 *   still says unpaid, which is the one that costs the organisation a customer.
 * - **Amount mismatch.** A payment exists but is not for what the gateway
 *   charged. P5 hands an unexpected amount straight back, so a row here means
 *   something got past that: an order edited after it was paid, or a partial
 *   capture.
 * - **Missing intent.** A card payment quotes a reference this database has no
 *   attempt row for, so nothing on this side can be checked at all.
 *
 * Every finding has a **fingerprint** — its kind plus the row it is about — and
 * the fingerprint is unique. A sweep that finds the same problem again updates
 * the row it already wrote and reports it as nothing new, which is what makes
 * this safe to run nightly: one unmatched charge is one ticket, not thirty. A
 * finding that no longer holds is closed rather than deleted, because "this was
 * wrong for a fortnight and then somebody fixed it" is worth being able to read.
 *
 * **This function authenticates nobody.** The route that calls it does.
 */
export const PAYMENT_RECONCILIATION_JOB = 'payments.reconciliation';

/** The gateway's word for "the money arrived". */
const PAID_INTENT_STATUS = 'paid';

export type ReconciliationSummary = {
  runId: string;
  checkedCount: number;
  flaggedCount: number;
  newFlagCount: number;
  resolvedCount: number;
};

type Finding = {
  fingerprint: string;
  kind: ReconciliationFlagKind;
  orderId: string | null;
  stripeSessionId: string | null;
  stripeIntentId: string | null;
  amountCents: number;
  expectedCents: number;
  note: string;
};

export async function reconcilePayments(input: {
  source: 'manual' | 'cron';
  staffUserId?: string | null;
}): Promise<ReconciliationSummary> {
  return runCronJobBody(PAYMENT_RECONCILIATION_JOB, async () => {
    const run = await db.paymentReconciliationRun.create({
      data: { source: input.source, ranByStaffUserId: input.staffUserId ?? null },
    });

    const { findings, checkedCount } = await collectFindings();
    const newFlagCount = await writeFindings(run.id, findings);
    const resolvedCount = await closeFixedFindings(findings.map((finding) => finding.fingerprint));

    const summary: ReconciliationSummary = {
      runId: run.id,
      checkedCount,
      flaggedCount: findings.length,
      newFlagCount,
      resolvedCount,
    };

    await db.paymentReconciliationRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        checkedCount,
        flaggedCount: findings.length,
        newFlagCount,
      },
    });

    return { value: summary, itemsProcessed: checkedCount, detail: { ...summary } };
  });
}

async function collectFindings(): Promise<{ findings: Finding[]; checkedCount: number }> {
  const [intents, stripePayments, attempts] = await Promise.all([
    db.stripePaymentIntent.findMany({
      where: { status: PAID_INTENT_STATUS },
      select: {
        orderId: true,
        stripeSessionId: true,
        stripeIntentId: true,
        amountCents: true,
        order: { select: { totalCents: true } },
      },
    }),
    db.payment.findMany({
      where: { method: 'STRIPE', state: 'POSTED' },
      select: { id: true, orderId: true, reference: true, amountCents: true },
    }),
    // "Is there an attempt on file?" is a different question from "did the
    // gateway say it was paid?". An intent still reading `open` because the
    // webhook's status update lost a race is an attempt on file, and reporting
    // its payment as having none sends the office looking for nothing.
    db.stripePaymentIntent.findMany({
      where: { stripeIntentId: { not: null } },
      select: { stripeIntentId: true },
    }),
  ]);

  const paymentsByReference = new Map(
    stripePayments.flatMap((payment) =>
      payment.reference === null ? [] : [[payment.reference, payment] as const],
    ),
  );
  const intentIds = new Set(
    attempts.flatMap((attempt) => (attempt.stripeIntentId === null ? [] : [attempt.stripeIntentId])),
  );

  const findings: Finding[] = [];

  for (const intent of intents) {
    const matched =
      intent.stripeIntentId === null ? undefined : paymentsByReference.get(intent.stripeIntentId);

    if (!matched) {
      findings.push({
        fingerprint: `orphaned_intent:${intent.stripeSessionId}`,
        kind: 'ORPHANED_INTENT',
        orderId: intent.orderId,
        stripeSessionId: intent.stripeSessionId,
        stripeIntentId: intent.stripeIntentId,
        amountCents: intent.amountCents,
        expectedCents: intent.order.totalCents,
        note: 'The gateway says this session was paid and no payment was recorded against it.',
      });
      continue;
    }

    // The payment and the attempt are written from one number in one
    // transaction, so comparing them to each other can only ever agree. What
    // can drift is the order: edited after it was paid, or captured in part.
    if (matched.amountCents !== intent.order.totalCents) {
      findings.push({
        fingerprint: `amount_mismatch:${intent.stripeSessionId}`,
        kind: 'AMOUNT_MISMATCH',
        orderId: intent.orderId,
        stripeSessionId: intent.stripeSessionId,
        stripeIntentId: intent.stripeIntentId,
        amountCents: matched.amountCents,
        expectedCents: intent.order.totalCents,
        note: 'The payment on file is not for what this order costs.',
      });
    }
  }

  for (const payment of stripePayments) {
    if (payment.reference !== null && intentIds.has(payment.reference)) continue;

    // The money on this finding is on this side, not the gateway side: the
    // payment is here and it is the checkout attempt that is missing. Filed the
    // way the screen reads it, so "gateway 0, expected 39" says which of the two
    // is the one nobody can find.
    findings.push({
      fingerprint: `missing_intent:${payment.id}`,
      kind: 'MISSING_INTENT',
      orderId: payment.orderId,
      stripeSessionId: null,
      stripeIntentId: payment.reference,
      amountCents: 0,
      expectedCents: payment.amountCents,
      note: 'This card payment quotes a gateway reference with no checkout attempt on file.',
    });
  }

  return { findings, checkedCount: intents.length + stripePayments.length };
}

/**
 * One upsert per finding, keyed on the fingerprint. The update branch only moves
 * the "last seen" stamps, so a finding somebody has been working on keeps the
 * date it first appeared.
 *
 * Upsert rather than look-then-write because the nightly run and the button are
 * the same sweep: two of them starting together would both see no flag, both
 * insert, and the second would hit the unique index and fail a run over a
 * finding that had just been filed correctly. The count of new findings is read
 * before the writes, so in that race one sweep reports the finding as new and
 * the other reports it as new too — a number being generous is a much smaller
 * problem than a failed sweep.
 */
async function writeFindings(runId: string, findings: Finding[]): Promise<number> {
  const known = await db.paymentReconciliationFlag.findMany({
    where: { fingerprint: { in: findings.map((finding) => finding.fingerprint) } },
    select: { fingerprint: true },
  });
  const alreadyFiled = new Set(known.map((flag) => flag.fingerprint));

  for (const finding of findings) {
    await db.paymentReconciliationFlag.upsert({
      where: { fingerprint: finding.fingerprint },
      create: { ...finding, lastSeenRunId: runId },
      update: {
        status: 'OPEN',
        resolvedAt: null,
        lastSeenAt: new Date(),
        lastSeenRunId: runId,
        amountCents: finding.amountCents,
        expectedCents: finding.expectedCents,
        note: finding.note,
      },
    });
  }

  return findings.filter((finding) => !alreadyFiled.has(finding.fingerprint)).length;
}

async function closeFixedFindings(stillOpen: string[]): Promise<number> {
  const closed = await db.paymentReconciliationFlag.updateMany({
    where: { status: 'OPEN', fingerprint: { notIn: stillOpen } },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  });

  return closed.count;
}

export function readReconciliationFlags(take = 50) {
  return db.paymentReconciliationFlag.findMany({
    include: { order: { select: { orderNumber: true, totalCents: true } } },
    orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
    take,
  });
}

export function readReconciliationRuns(take = 5) {
  return db.paymentReconciliationRun.findMany({
    include: { ranBy: { select: { fullName: true } } },
    orderBy: { startedAt: 'desc' },
    take,
  });
}
