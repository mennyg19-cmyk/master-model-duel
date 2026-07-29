import { OrderStatus, PaymentStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

// One tone mapping for order/payment status across dashboard, list, detail,
// and POS — the color language must mean the same thing on every screen.
const ORDER_TONES: Record<OrderStatus, { tone: "green" | "amber" | "stone" | "red"; label: string }> = {
  DRAFT: { tone: "amber", label: "Draft" },
  FINALIZED: { tone: "green", label: "Finalized" },
  DISCARDED: { tone: "stone", label: "Discarded" },
};

const PAYMENT_TONES: Record<PaymentStatus, { tone: "green" | "amber" | "red" | "stone"; label: string }> = {
  UNPAID: { tone: "red", label: "Unpaid" },
  PARTIAL: { tone: "amber", label: "Partial" },
  PAID: { tone: "green", label: "Paid" },
  OVERPAID: { tone: "stone", label: "Overpaid" },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { tone, label } = ORDER_TONES[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { tone, label } = PAYMENT_TONES[status];
  return <Badge tone={tone}>{label}</Badge>;
}
