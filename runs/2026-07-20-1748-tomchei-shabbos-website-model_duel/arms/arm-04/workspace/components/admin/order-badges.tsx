import { Badge } from "@/components/ui/badge";
import type { OrderPaymentStatus, OrderStatus } from "@prisma/client";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const tone = status === "FINALIZED" ? "brand" : status === "DISCARDED" ? "danger" : "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: OrderPaymentStatus }) {
  const tone =
    status === "PAID" || status === "COMPED" ? "success" : status === "PARTIAL" ? "brand" : "danger";
  return <Badge tone={tone}>{status}</Badge>;
}
