import {
  AuditAction,
  CachedPaymentStatus,
  PaymentState,
  ReconcileStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { err, maskError, ok, type Result } from "@/lib/result";

export type ReconcileResult = {
  runId: string;
  orphanedCount: number;
  matchedCount: number;
  adjustedCount: number;
  createdAdjustments: number;
  skippedDuplicates: number;
  orphans: Array<{
    stripePaymentIntentId: string;
    orderId: string;
    amountCents: number;
    status: string;
  }>;
};

/**
 * Stripe payment reconciliation matcher (R-093).
 * Orphan = PaymentIntent succeeded (or requires_capture) but order has no POSTED payment
 * covering the intent, or order still unpaid.
 * Rerun uses unique fingerprint so adjustments are not duplicated.
 */
export async function runPaymentReconcile(input: {
  triggeredBy: "manual" | "cron";
  staffId?: string | null;
}): Promise<Result<ReconcileResult>> {
  try {
    const run = await db.paymentReconcileRun.create({
      data: {
        status: ReconcileStatus.RUNNING,
        triggeredBy: input.triggeredBy,
        staffId: input.staffId ?? null,
      },
    });

    // Cap load for scale hardening — newest intents first (cron + manual).
    const intents = await db.stripePaymentIntent.findMany({
      orderBy: { createdAt: "desc" },
      take: 2_000,
      include: {
        order: {
          include: {
            payments: { where: { state: PaymentState.POSTED } },
          },
        },
      },
    });

    const orphans: ReconcileResult["orphans"] = [];
    let matchedCount = 0;
    let createdAdjustments = 0;
    let skippedDuplicates = 0;

    for (const intent of intents) {
      const successLike =
        intent.status === "succeeded" ||
        intent.status === "requires_capture" ||
        intent.status === "processing";
      if (!successLike) continue;

      const postedTotal = intent.order.payments.reduce(
        (sum, p) => sum + p.amountCents - p.refundedCents,
        0,
      );
      const orderPaid =
        intent.order.paymentStatusCached === CachedPaymentStatus.PAID ||
        postedTotal >= intent.amountCents;

      // Matched when a POSTED payment references this PI or charge covers amount.
      const hasLinkedPayment = intent.order.payments.some(
        (p) =>
          p.stripeChargeId === intent.stripePaymentIntentId ||
          p.reference === intent.stripePaymentIntentId,
      );

      if (orderPaid && (hasLinkedPayment || postedTotal >= intent.amountCents)) {
        matchedCount += 1;
        continue;
      }

      orphans.push({
        stripePaymentIntentId: intent.stripePaymentIntentId,
        orderId: intent.orderId,
        amountCents: intent.amountCents,
        status: intent.status,
      });

      const fingerprint = `orphan:${intent.stripePaymentIntentId}`;
      const existingAdj = await db.paymentReconcileAdjustment.findUnique({
        where: { fingerprint },
      });
      if (existingAdj) {
        skippedDuplicates += 1;
      } else {
        await db.paymentReconcileAdjustment.create({
          data: {
            runId: run.id,
            fingerprint,
            kind: "ORPHANED_PAYMENT_INTENT",
            stripePaymentIntentId: intent.stripePaymentIntentId,
            orderId: intent.orderId,
            amountCents: intent.amountCents,
            note: `Orphaned PI status=${intent.status}; orderPaid=${orderPaid}`,
          },
        });
        createdAdjustments += 1;
      }
    }

    const finished = await db.paymentReconcileRun.update({
      where: { id: run.id },
      data: {
        status: ReconcileStatus.COMPLETED,
        orphanedCount: orphans.length,
        matchedCount,
        adjustedCount: createdAdjustments,
        finishedAt: new Date(),
        summary: {
          createdAdjustments,
          skippedDuplicates,
          orphanIds: orphans.map((o) => o.stripePaymentIntentId),
        },
      },
    });

    await writeAudit({
      action: AuditAction.RECONCILE_RUN,
      actorId: input.staffId ?? null,
      meta: {
        runId: finished.id,
        triggeredBy: input.triggeredBy,
        orphanedCount: orphans.length,
        matchedCount,
        createdAdjustments,
        skippedDuplicates,
      },
    });

    return ok({
      runId: finished.id,
      orphanedCount: orphans.length,
      matchedCount,
      adjustedCount: createdAdjustments,
      createdAdjustments,
      skippedDuplicates,
      orphans,
    });
  } catch (error) {
    return err(maskError(error), "Payment reconciliation failed.");
  }
}

export async function listReconcileRuns(limit = 20) {
  return db.paymentReconcileRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    include: {
      adjustments: { take: 50, orderBy: { createdAt: "desc" } },
      staff: { select: { displayName: true } },
    },
  });
}
