import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { CheckoutSubmitInput } from "@/lib/checkout/fulfillment";
import { submitCheckout } from "@/lib/checkout/submit";
import { finalizePosOrder } from "@/lib/checkout/pos";
import { postPaymentTx } from "@/lib/payments/post";
import { PaymentMethod } from "@prisma/client";

// R-059..R-061: counter checkout in one staff click — submit (validate,
// freeze fees, reserve stock), finalize (commit stock, claim the order
// number), then post cash/check/comp with the staff audit row. Each step
// commits separately and is individually retry-safe: a crash between steps
// leaves a submitted draft the next click finalizes, never a double charge
// (offline money only posts here, never through Stripe).
const OFFLINE_METHODS = { cash: "CASH", check: "CHECK", comp: "COMP" } as const;

export interface PosCheckoutOutcome {
  orderId: string;
  orderNumber: number;
  wireFormat: string | null;
  totalCents: number;
  payment: { id: string; method: PaymentMethod; amountCents: number };
}

export async function checkoutPosOrder(input: {
  checkout: CheckoutSubmitInput;
  amountCents?: number;
  ctx: AuditContextLike;
}): Promise<PosCheckoutOutcome> {
  // The staff flag unlocks both draft access and offline methods; the route
  // gated payments.manage before constructing it.
  const summary = await submitCheckout(input.checkout, { staff: true });
  if (!summary) throw new NotFoundError("Order", input.checkout.draftRef);

  const draft = await prisma.order.findUnique({ where: { draftRef: input.checkout.draftRef } });
  if (!draft) throw new NotFoundError("Order", input.checkout.draftRef);
  const finalized = await finalizePosOrder(draft.id);

  // The route already refused "card"; anything else unknown here is a schema
  // drift bug and must surface as a refusal, never a silent cash default.
  const method = OFFLINE_METHODS[input.checkout.method as keyof typeof OFFLINE_METHODS];
  if (!method) {
    throw new DomainRuleError(`POS checkout takes cash, check, or comp; got "${input.checkout.method}"`);
  }
  const amountCents = input.amountCents ?? finalized.totalCents;
  if (amountCents > finalized.totalCents) {
    throw new DomainRuleError(
      `POS payment of ${amountCents} cents exceeds the order total ${finalized.totalCents} cents — post at most what the order owes`,
    );
  }
  const payment = await prisma.$transaction(async (tx) => {
    const posted = await postPaymentTx(tx, {
      orderId: finalized.id,
      method,
      amountCents,
      postedById: input.ctx.staff.id,
    });
    // Same transaction as the money: the audit row can never be lost to a
    // crash between commit and audit (UR-011 discipline).
    await recordAudit(
      {
        ctx: input.ctx,
        action: "payment_post",
        targetType: "Payment",
        targetId: posted.id,
        metadata: {
          orderId: finalized.id,
          orderNumber: finalized.orderNumber,
          method: posted.method,
          amountCents: posted.amountCents,
          channel: "pos",
        },
      },
      tx,
    );
    return posted;
  });

  return {
    orderId: finalized.id,
    orderNumber: finalized.orderNumber!,
    wireFormat: finalized.wireFormat,
    totalCents: finalized.totalCents,
    payment: { id: payment.id, method: payment.method, amountCents: payment.amountCents },
  };
}
