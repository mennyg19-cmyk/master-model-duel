import { Order, OrderStatus, Prisma } from "@prisma/client";
import { prisma, reloadOrThrow } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { AuditContextLike, recordAudit } from "@/lib/audit";
import { claimOrderNumber, formatWireFormat } from "@/lib/orders/numbers";
import { releaseOrderReservation } from "@/lib/checkout/reservations";

// R-044..R-046: draft → finalized | discarded; terminal states never move.
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["FINALIZED", "DISCARDED"],
  FINALIZED: [],
  DISCARDED: [],
};

export class IllegalTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    // ASCII arrow: this text lands in audit metadata, and the embedded DB is
    // WIN1252-encoded — a Unicode arrow would fail the audit insert.
    super(`Illegal order transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

// The conditional UPDATE lost the race: a concurrent transaction already moved
// the order out of DRAFT between our read and our write.
export class OrderConcurrencyError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} was changed concurrently; reload and retry`);
    this.name = "OrderConcurrencyError";
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

// The checkout engine finalizes inside its own transaction (stock commit +
// payment post + number claim must roll back together), so the finalize core
// takes the tx client. The standalone wrapper keeps P2 callers unchanged.
export async function finalizeOrderTx(tx: Prisma.TransactionClient, orderId: string): Promise<Order> {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { season: true } });
  if (!order) throw new NotFoundError("Order", orderId);
  assertTransition(order.status, "FINALIZED");
  // Same open-season gate as createDraftOrder (UR-008): a draft created while
  // the season was open may not be finalized after it closed.
  if (order.season.status !== "OPEN") {
    throw new DomainRuleError(`Season ${order.season.name} is closed; expected OPEN to finalize`);
  }

  const orderNumber = await claimOrderNumber(tx, order.seasonId);
  const updated = await tx.order.updateMany({
    where: { id: orderId, status: "DRAFT" },
    data: {
      status: "FINALIZED",
      orderNumber,
      wireFormat: formatWireFormat(order.season.name, orderNumber),
      version: { increment: 1 },
    },
  });
  if (updated.count === 0) throw new OrderConcurrencyError(orderId);
  return reloadOrThrow(() => tx.order.findUnique({ where: { id: orderId } }), "Order", orderId);
}

// Finalize claims the season's next order number and flips DRAFT → FINALIZED
// in one transaction. The conditional UPDATE (status = DRAFT) makes a second
// concurrent finalizer a no-op row count → throw → rollback, so the number
// can never be double-claimed.
export async function finalizeOrder(orderId: string): Promise<Order> {
  return prisma.$transaction((tx) => finalizeOrderTx(tx, orderId));
}

// Discard uses the same conditional-UPDATE guard as finalize (WHERE status =
// DRAFT): a discard that raced a finalize is a no-op row count → throw →
// rollback, so a finalized order can never be clobbered to DISCARDED. With an
// audit context, the order_discard row commits in the same transaction as the
// mutation (UR-011 discipline — a discard is destructive and must never go
// un-audited, even when the caller's summary audit fails afterwards).
export async function discardOrder(orderId: string, audit?: { ctx: AuditContextLike }): Promise<Order> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError("Order", orderId);
    assertTransition(order.status, "DISCARDED");
    // A checkout-started draft never carries its reservation into the
    // terminal state (no-op when nothing was reserved).
    await releaseOrderReservation(tx, orderId);
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: "DRAFT" },
      data: { status: "DISCARDED", version: { increment: 1 } },
    });
    if (updated.count === 0) throw new OrderConcurrencyError(orderId);
    if (audit) {
      await recordAudit(
        {
          ctx: audit.ctx,
          action: "order_discard",
          targetType: "Order",
          targetId: orderId,
          metadata: { orderLabel: order.wireFormat ?? order.draftRef },
        },
        tx,
      );
    }
    return reloadOrThrow(() => tx.order.findUnique({ where: { id: orderId } }), "Order", orderId);
  });
}
