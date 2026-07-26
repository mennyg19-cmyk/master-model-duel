import 'server-only';

import type { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';

import { db } from '../db';

/**
 * What the office needs to take money against an order (UR-011, R-053).
 *
 * This is the money view only — the full order desk, search and bulk actions are
 * the operations hub in the next phase. It stays separate from the customer's
 * own order reader because the two answer different questions: a customer sees
 * what they bought, staff see what has been paid, by whom, and what went back.
 */
export type StaffOrderRow = {
  id: string;
  orderNumber: number | null;
  draftReference: string;
  customerName: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  totalCents: number;
  amountPaidCents: number;
  placedAt: Date | null;
};

export type StaffPaymentRow = {
  id: string;
  method: PaymentMethod;
  amountCents: number;
  refundedCents: number;
  state: 'POSTED' | 'VOIDED';
  reference: string | null;
  receivedAt: Date;
  voidReason: string | null;
  recordedBy: string | null;
};

export type StaffOrderMoney = StaffOrderRow & {
  seasonLabel: string;
  customerEmail: string | null;
  subtotalCents: number;
  fulfillmentFeeCents: number;
  payments: StaffPaymentRow[];
  /** Frozen at checkout, shown because a later method change must not move it (G-028). */
  packageFees: { id: string; recipientName: string; methodLabel: string; feeCents: number }[];
};

const RECENT_ORDER_LIMIT = 50;

export async function listStaffOrders(): Promise<StaffOrderRow[]> {
  const rows = await db.order.findMany({
    where: { status: { notIn: ['DRAFT', 'DISCARDED'] } },
    include: { customer: { select: { fullName: true } } },
    orderBy: [{ placedAt: 'desc' }],
    take: RECENT_ORDER_LIMIT,
  });

  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    draftReference: row.draftReference,
    customerName: row.customer?.fullName ?? 'Guest',
    status: row.status,
    paymentStatus: row.paymentStatus,
    totalCents: row.totalCents,
    amountPaidCents: row.amountPaidCents,
    placedAt: row.placedAt,
  }));
}

export async function readStaffOrderMoney(orderId: string): Promise<StaffOrderMoney | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      season: { select: { label: true } },
      customer: { select: { fullName: true, email: true } },
      payments: {
        include: { refunds: true, recorded: { select: { fullName: true } } },
        orderBy: { receivedAt: 'asc' },
      },
      packages: {
        include: { fulfillmentMethod: { select: { label: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!order) return null;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    draftReference: order.draftReference,
    customerName: order.customer?.fullName ?? 'Guest',
    customerEmail: order.customer?.email ?? null,
    seasonLabel: order.season.label,
    status: order.status,
    paymentStatus: order.paymentStatus,
    subtotalCents: order.subtotalCents,
    fulfillmentFeeCents: order.fulfillmentFeeCents,
    totalCents: order.totalCents,
    amountPaidCents: order.amountPaidCents,
    placedAt: order.placedAt,
    payments: order.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amountCents: payment.amountCents,
      refundedCents: payment.refunds.reduce((total, refund) => total + refund.amountCents, 0),
      state: payment.state,
      reference: payment.reference,
      receivedAt: payment.receivedAt,
      voidReason: payment.voidReason,
      recordedBy: payment.recorded?.fullName ?? null,
    })),
    packageFees: order.packages.map((row) => ({
      id: row.id,
      recipientName: row.recipientName,
      methodLabel: row.fulfillmentMethod.label,
      feeCents: row.fulfillmentFeeCents,
    })),
  };
}
