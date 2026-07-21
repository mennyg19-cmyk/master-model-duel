/**
 * Single Stripe payment reconciliation entrypoint (R-093).
 * Implementation lives in `lib/ops/reconcile` — fingerprints are `orphan:<piId>`.
 * This module re-exports for any leftover imports; do not add a second matcher.
 */
export {
  runPaymentReconcile as runPaymentReconciliation,
  listReconcileRuns,
  type ReconcileResult,
} from "@/lib/ops/reconcile";

import {
  CachedPaymentStatus,
  PaymentMethod,
  PaymentState,
} from "@prisma/client";
import { db } from "@/lib/db";
import { mintMockPaymentIntentId } from "@/lib/stripe/client";

/** Seed an orphaned succeeded PaymentIntent for smoke (no Payment row). */
export async function seedOrphanPaymentIntent(input?: {
  orderId?: string;
  amountCents?: number;
}): Promise<{ stripePaymentIntentId: string; orderId: string }> {
  let orderId = input?.orderId;
  if (!orderId) {
    const order = await db.order.findFirst({
      where: {
        paymentStatusCached: CachedPaymentStatus.UNPAID,
        status: { in: ["PLACED", "PAID"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!order) {
      const any = await db.order.findFirst({
        where: { status: { notIn: ["DRAFT", "DISCARDED"] } },
        orderBy: { createdAt: "desc" },
      });
      if (!any) throw new Error("No order available for orphan PI seed");
      orderId = any.id;
    } else {
      orderId = order.id;
    }
  }

  const stripePaymentIntentId = mintMockPaymentIntentId();
  await db.stripePaymentIntent.create({
    data: {
      orderId,
      stripePaymentIntentId,
      status: "succeeded",
      amountCents: input?.amountCents ?? 5000,
    },
  });

  await db.payment.deleteMany({
    where: {
      orderId,
      method: PaymentMethod.STRIPE,
      reference: stripePaymentIntentId,
    },
  });

  return { stripePaymentIntentId, orderId };
}
