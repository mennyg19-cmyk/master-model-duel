import 'server-only';

import type { OrderStatus, PackageStage, PaymentMethod, PaymentStatus } from '@prisma/client';

import { destinationLabel } from '../addresses/address-mapping';
import { db } from '../db';
import { lineTotalWithAddOns, optionsLabel } from './lines';

/**
 * What the office needs to take money against one order (UR-011, R-053).
 *
 * This is the money view of a single order; searching and paging the desk lives
 * in `order-desk.ts`. It stays separate from the customer's own order reader
 * because the two answer different questions: a customer sees what they bought,
 * staff see what has been paid, by whom, and what went back.
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

/**
 * What is actually in the order, box by box (R-063).
 *
 * Staff answering "did her box get the honey" need the contents next to the
 * money, and they need it grouped the way the order will be packed rather than
 * the way it was typed. A placed order already carries that grouping — finalize
 * wrote it — so this reads the packages rather than re-deriving them, which is
 * how the screen and the packing list stay the same answer.
 */
export type StaffOrderBox = {
  id: string;
  recipientName: string;
  methodLabel: string;
  destination: string;
  deliveryDay: string | null;
  greetingMessage: string | null;
  stage: PackageStage;
  itemCount: number;
  lines: {
    id: string;
    name: string;
    options: string;
    quantity: number;
    totalCents: number;
    addOns: string[];
  }[];
  /**
   * The live labels on the box. Cancelled and failed ones are left out: the
   * order desk is answering "where is it", and only a label that is still good
   * can answer that. The packing table sees the whole history.
   */
  parcels: { carrier: string; trackingNumber: string; trackingStatus: string | null }[];
};

export async function readStaffOrderBoxes(orderId: string): Promise<StaffOrderBox[]> {
  const packages = await db.package.findMany({
    where: { orderId },
    include: {
      fulfillmentMethod: { select: { label: true } },
      pickupLocation: { select: { name: true } },
      lines: { include: { addOns: true }, orderBy: { createdAt: 'asc' } },
      shipmentBoxes: {
        where: { status: 'PURCHASED', trackingNumber: { not: null } },
        orderBy: { parcelIndex: 'asc' },
      },
    },
    orderBy: { recipientName: 'asc' },
  });

  return packages.map((box) => ({
    id: box.id,
    recipientName: box.recipientName,
    methodLabel: box.fulfillmentMethod.label,
    destination: destinationLabel(box) ?? '—',
    deliveryDay: box.deliveryDay,
    greetingMessage: box.greetingMessage,
    stage: box.stage,
    itemCount: box.lines.reduce((count, line) => count + line.quantity, 0),
    lines: box.lines.map((line) => ({
      id: line.id,
      name: line.productNameSnapshot,
      options: optionsLabel(line.optionsSnapshot),
      quantity: line.quantity,
      totalCents: lineTotalWithAddOns(line),
      addOns: line.addOns.map((addOn) => addOn.addOnNameSnapshot),
    })),
    parcels: box.shipmentBoxes.map((parcel) => ({
      carrier: parcel.carrier ?? 'Carrier',
      trackingNumber: parcel.trackingNumber ?? '',
      trackingStatus: parcel.trackingStatus,
    })),
  }));
}
