import { Prisma, ReconciliationFindingKind, ReconciliationRun } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit, AuditContextLike } from "@/lib/audit";
import { listPaymentIntents, StripeDriverMode, StripeNotConfiguredError, stripeDriverMode } from "@/lib/payments/stripe";

// R-093: Stripe payment reconciliation. The matcher compares the Stripe-side
// intent list against local mirrors (StripePaymentIntent) and the posted
// payment ledger (Payment.externalRef). It NEVER writes payments — flagging
// is the whole output, so a rerun over unchanged data can only reproduce the
// same finding set, never duplicate an adjustment.

export interface FindingDraft {
  kind: ReconciliationFindingKind;
  intentId?: string;
  orderId?: string;
  detail: string;
}

export interface ReconcileResult {
  run: ReconciliationRun;
  findings: FindingDraft[];
}

function findingKey(finding: FindingDraft): string {
  return `${finding.kind}:${finding.intentId ?? ""}:${finding.orderId ?? ""}`;
}

export async function runReconciliation(input: { ctx?: AuditContextLike | null } = {}): Promise<ReconcileResult> {
  const mode: StripeDriverMode = stripeDriverMode();
  const run = await prisma.reconciliationRun.create({
    data: {
      mode,
      actorId: input.ctx?.staff.id ?? null,
      actorEmail: input.ctx?.staff.email ?? null,
    },
  });

  try {
    // Capture mode (no keys, no double): nothing Stripe-side exists to list —
    // the run still audits local mirrors for internal consistency and says so.
    let stripeSide: Awaited<ReturnType<typeof listPaymentIntents>> = [];
    let stripeSideNote = "live list";
    try {
      stripeSide = await listPaymentIntents();
      if (mode === "fixture") stripeSideNote = "fixture list";
    } catch (error) {
      if (!(error instanceof StripeNotConfiguredError)) throw error;
      stripeSideNote = "capture: no Stripe side to check (STRIPE_SECRET_KEY missing)";
    }

    const [mirrors, payments] = await Promise.all([
      prisma.stripePaymentIntent.findMany(),
      prisma.payment.findMany({ where: { externalRef: { not: null }, status: "POSTED" } }),
    ]);
    const mirrorByIntent = new Map(mirrors.map((mirror) => [mirror.intentId, mirror]));
    const paymentByRef = new Map(payments.map((payment) => [payment.externalRef!, payment]));
    const stripeIds = new Set(stripeSide.map((intent) => intent.id));

    const drafts = new Map<string, FindingDraft>();
    const add = (finding: FindingDraft) => drafts.set(findingKey(finding), finding);

    let matched = 0;
    let skippedForeign = 0;
    for (const intent of stripeSide) {
      const orderId = intent.metadata.orderId;
      if (!orderId) {
        // An intent with no order reference isn't ours — other tools share
        // the Stripe account; reconciling it would invent findings.
        skippedForeign += 1;
        continue;
      }
      const mirror = mirrorByIntent.get(intent.id);
      if (!mirror) {
        add({
          kind: "ORPHANED_INTENT",
          intentId: intent.id,
          orderId,
          detail: `Stripe intent ${intent.id} (${intent.status}, ${intent.amountCents}¢) references order ${orderId} but no local mirror exists — a completed checkout whose webhook never landed.`,
        });
        continue;
      }
      if (mirror.status !== intent.status) {
        add({
          kind: "STATUS_DRIFT",
          intentId: intent.id,
          orderId,
          detail: `Mirror says "${mirror.status}", Stripe says "${intent.status}".`,
        });
        continue;
      }
      const payment = paymentByRef.get(intent.id);
      if (intent.status === "succeeded" && !payment) {
        add({
          kind: "MISSING_PAYMENT",
          intentId: intent.id,
          orderId,
          detail: `Intent ${intent.id} succeeded for ${intent.amountCents}¢ but no posted payment references it.`,
        });
        continue;
      }
      if (payment && payment.amountCents !== intent.amountCents) {
        add({
          kind: "AMOUNT_MISMATCH",
          intentId: intent.id,
          orderId,
          detail: `Posted payment is ${payment.amountCents}¢; Stripe intent is ${intent.amountCents}¢.`,
        });
        continue;
      }
      matched += 1;
    }

    // Stale mirrors are only knowable with a real Stripe-side list. Live mode
    // with an empty list means the mirrors really are stale; fixture mode with
    // an empty list only means the dev double wasn't seeded, so flagging every
    // mirror there would be a false positive (m6).
    if (stripeSide.length > 0 || mode === "live") {
      for (const mirror of mirrors) {
        if (!stripeIds.has(mirror.intentId)) {
          add({
            kind: "STALE_MIRROR",
            intentId: mirror.intentId,
            orderId: mirror.orderId,
            detail: `Local mirror for ${mirror.intentId} ("${mirror.status}") is not in the Stripe-side list.`,
          });
        }
      }
    }

    const findings = [...drafts.values()];
    const finished = await prisma.$transaction(async (tx) => {
      if (findings.length > 0) {
        await tx.reconciliationFinding.createMany({
          data: findings.map((finding) => ({
            runId: run.id,
            kind: finding.kind,
            intentId: finding.intentId ?? null,
            orderId: finding.orderId ?? null,
            detail: finding.detail,
          })),
        });
      }
      return tx.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: "OK",
          checkedCount: stripeSide.length,
          matchedCount: matched,
          flaggedCount: findings.length,
          finishedAt: new Date(),
          message: `${stripeSideNote}; ${skippedForeign} foreign intent(s) skipped`,
        },
      });
    });

    await recordAudit({
      ctx: input.ctx ?? undefined,
      actor: input.ctx ? undefined : null,
      action: "reconcile_run",
      targetType: "ReconciliationRun",
      targetId: run.id,
      metadata: {
        mode,
        checked: stripeSide.length,
        matched,
        flagged: findings.length,
        kinds: findings.map((finding) => finding.kind),
      } as Prisma.InputJsonValue,
    });

    return { run: finished, findings };
  } catch (error) {
    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        message: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
