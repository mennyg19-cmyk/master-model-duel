import { Order } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { checkoutInclude } from "@/lib/checkout/order-load";
import { commitSubmittedOrder } from "@/lib/checkout/finalize";

// Raised when a POS finalize collides with an in-flight Stripe session. The
// route maps it to 409 (conflict with current state), distinct from a plain
// domain-rule 422.
export class SessionInFlightError extends Error {
  constructor() {
    super("A Stripe checkout session is in flight for this order; wait for it to complete or expire before a POS finalize");
    this.name = "SessionInFlightError";
  }
}

// UR-011/G-028 POS half: staff finalize a submitted draft at the counter
// (payment posts separately with its own audit). Same rules as the web path
// — checkout choices and frozen fees must exist; the reservation converts to
// a commit, never a double count.
export async function finalizePosOrder(orderId: string): Promise<Order> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: checkoutInclude });
    if (!order) throw new NotFoundError("Order", orderId);
    if (order.status !== "DRAFT") {
      throw new DomainRuleError(`Order ${orderId} is ${order.status}; expected DRAFT to finalize`);
    }
    if (order.season.status !== "OPEN") {
      throw new DomainRuleError(`Season ${order.season.name} is closed; expected OPEN to finalize`);
    }
    // A live hosted-checkout session on the same draft can still complete and
    // capture the card; finalizing here would strand that charge. Staff wait
    // for the session to resolve or expire (expiry releases it), or the
    // customer abandons it — never both paths on one draft.
    if (order.stripeSessionId) {
      throw new SessionInFlightError();
    }
    if (!order.stockReserved || order.recipients.some((recipient) => !recipient.fulfillmentChoice)) {
      throw new DomainRuleError("Checkout choices must be submitted before a POS finalize");
    }
    return commitSubmittedOrder(tx, order);
  });
}
