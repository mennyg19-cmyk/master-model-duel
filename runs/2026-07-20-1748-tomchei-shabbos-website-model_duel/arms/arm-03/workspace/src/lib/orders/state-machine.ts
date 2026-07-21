import { OrderStatus } from "@prisma/client";

const ALLOWED: Record<OrderStatus, ReadonlySet<OrderStatus>> = {
  [OrderStatus.DRAFT]: new Set([OrderStatus.PLACED, OrderStatus.DISCARDED]),
  [OrderStatus.PLACED]: new Set([OrderStatus.PAID, OrderStatus.CANCELLED]),
  [OrderStatus.PAID]: new Set([
    OrderStatus.FULFILLING,
    OrderStatus.CANCELLED,
    OrderStatus.COMPLETED,
  ]),
  [OrderStatus.FULFILLING]: new Set([
    OrderStatus.COMPLETED,
    OrderStatus.CANCELLED,
  ]),
  [OrderStatus.COMPLETED]: new Set(),
  [OrderStatus.CANCELLED]: new Set(),
  [OrderStatus.DISCARDED]: new Set(),
};

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return ALLOWED[from].has(to);
}

export function assertOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
): void {
  if (!canTransitionOrder(from, to)) {
    throw new Error(
      `Illegal order transition ${from} → ${to}. Expected one of: ${[...ALLOWED[from]].join(", ") || "(none)"}`,
    );
  }
}

export function allowedOrderTransitions(
  from: OrderStatus,
): OrderStatus[] {
  return [...ALLOWED[from]];
}
