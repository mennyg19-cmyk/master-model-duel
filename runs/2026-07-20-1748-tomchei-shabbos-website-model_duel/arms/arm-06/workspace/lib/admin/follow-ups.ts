import { prisma } from "@/lib/db";
import { loadUnclaimedPickups, loadPickupPolicy } from "@/lib/pickup/readiness";

// R-079: the follow-up call center read model. One work list per reason —
// unpaid balances, unclaimed pickups, bulk-scheduled customers — with the
// contact details and the one fact the caller needs. Filters are
// search-param driven (?reason=payment|pickup|bulk); no reason means all.

export type FollowUpReason = "payment" | "pickup" | "bulk";
export const FOLLOW_UP_REASONS: readonly FollowUpReason[] = ["payment", "pickup", "bulk"];

export interface FollowUpRow {
  reason: FollowUpReason;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  ref: string;
  detail: string;
}

export async function loadFollowUps(seasonId: string, reason?: FollowUpReason): Promise<FollowUpRow[]> {
  const rows: FollowUpRow[] = [];

  if (!reason || reason === "payment") {
    const orders = await prisma.order.findMany({
      where: { seasonId, status: "FINALIZED", paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
      include: {
        customer: { select: { name: true, email: true, phone: true } },
        payments: { where: { status: "POSTED" }, select: { amountCents: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    for (const order of orders) {
      const paidCents = order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
      const outstandingCents = order.totalCents - paidCents;
      if (outstandingCents <= 0) continue;
      rows.push({
        reason: "payment",
        customerName: order.customer.name,
        customerEmail: order.customer.email,
        customerPhone: order.customer.phone,
        ref: order.wireFormat ?? order.id,
        detail: `$${(outstandingCents / 100).toFixed(2)} outstanding${order.lastPaymentReminderAt ? ` · reminded ${order.lastPaymentReminderAt.toISOString().slice(0, 10)}` : " · never reminded"}`,
      });
    }
  }

  if (!reason || reason === "pickup") {
    const policy = await loadPickupPolicy();
    const unclaimed = await loadUnclaimedPickups(seasonId, policy);
    for (const pkg of unclaimed) {
      const readyAt = pkg.pickupReadyAt!;
      const daysWaiting = Math.floor((Date.now() - readyAt.getTime()) / (24 * 60 * 60 * 1000));
      rows.push({
        reason: "pickup",
        customerName: pkg.order.customer.name,
        customerEmail: pkg.order.customer.email,
        customerPhone: pkg.order.customer.phone,
        ref: pkg.order.wireFormat ?? pkg.order.id,
        detail: `pickup for ${pkg.recipientName} ready ${readyAt.toISOString().slice(0, 10)} · ${daysWaiting} day(s) waiting`,
      });
    }
  }

  if (!reason || reason === "bulk") {
    const schedules = await prisma.bulkDeliverySchedule.findMany({
      where: { seasonId },
      include: {
        items: {
          include: {
            package: { select: { recipientName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const latest = schedules[0];
    if (latest) {
      const byCustomer = new Map<string, { recipients: string[]; orderIds: Set<string> }>();
      for (const item of latest.items) {
        const entry = byCustomer.get(item.customerId) ?? { recipients: [], orderIds: new Set<string>() };
        entry.recipients.push(item.package.recipientName);
        entry.orderIds.add(item.orderId);
        byCustomer.set(item.customerId, entry);
      }
      const customers = await prisma.customer.findMany({
        where: { id: { in: [...byCustomer.keys()] } },
        select: { id: true, name: true, email: true, phone: true },
      });
      for (const customer of customers) {
        const entry = byCustomer.get(customer.id)!;
        rows.push({
          reason: "bulk",
          customerName: customer.name,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          ref: [...entry.orderIds].length === 1 ? `order ${[...entry.orderIds][0].slice(-8)}` : `${entry.orderIds.size} orders`,
          detail: `bulk delivery ${latest.deliveryDay}${latest.window ? ` (${latest.window})` : ""} · ${entry.recipients.length} package(s): ${entry.recipients.join(", ")}`,
        });
      }
    }
  }

  return rows;
}
