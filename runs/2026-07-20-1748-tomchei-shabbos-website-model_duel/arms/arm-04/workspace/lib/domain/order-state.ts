import type { OrderStatus } from "@prisma/client";

// Order lifecycle (R-044..R-046): drafts either finalize or get discarded.
// Finalized and discarded orders are terminal for status purposes; payment
// and fulfillment progress live on Payment and Package, not here.
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["FINALIZED", "DISCARDED"],
  FINALIZED: [],
  DISCARDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Illegal order transition ${from} -> ${to}; allowed from ${from}: ${
        ALLOWED_TRANSITIONS[from].join(", ") || "none"
      }`
    );
  }
}
