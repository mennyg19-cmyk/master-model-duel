import 'server-only';

import type { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';

import { addressSummary } from '../addresses/address-summary';
import { sumCents } from '../core/money';
import { db } from '../db';
import { findOwnedOrder, ownerFilter, type DraftOwner } from './draft-access';
import { lineTotalWithAddOns } from './lines';

/**
 * What the account area shows about an order. Two sources on purpose: a placed
 * order quotes the snapshot columns finalize wrote, because that is what the
 * customer agreed to pay, while a draft is still being edited and has to be
 * added up from the lines it has right now.
 */
export type OrderSummary = {
  id: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  orderNumber: number | null;
  draftReference: string;
  seasonLabel: string;
  itemCount: number;
  recipientCount: number;
  unassignedCount: number;
  totalCents: number;
  placedAt: Date | null;
  createdAt: Date;
};

export type OrderDetail = OrderSummary & {
  subtotalCents: number;
  fulfillmentFeeCents: number;
  amountPaidCents: number;
  lines: {
    id: string;
    name: string;
    quantity: number;
    lineTotalCents: number;
    options: string;
    addOns: string[];
    recipientName: string | null;
    methodLabel: string | null;
    destination: string | null;
    greetingMessage: string | null;
  }[];
  packages: { id: string; recipientName: string; stage: string; methodLabel: string }[];
};

const SUMMARY_INCLUDE = {
  season: { select: { label: true } },
  lines: {
    select: {
      quantity: true,
      lineTotalCents: true,
      recipientName: true,
      addressPostalCode: true,
      addOns: { select: { lineTotalCents: true } },
    },
  },
} satisfies Prisma.OrderInclude;

type SummaryRow = Prisma.OrderGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

/** R-038. Newest first, with the draft in progress at the top where it is useful. */
export async function listCustomerOrders(customerId: string): Promise<OrderSummary[]> {
  const rows = await db.order.findMany({
    where: { customerId, status: { not: 'DISCARDED' } },
    include: SUMMARY_INCLUDE,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });

  return rows.map(toSummary);
}

/**
 * R-039. Null covers both "no such order" and "not yours", so an id from a URL
 * cannot be used to find out which orders exist (R-121).
 */
export async function readOrderDetail(
  owner: DraftOwner,
  orderId: string,
): Promise<OrderDetail | null> {
  const owned = await findOwnedOrder(owner, orderId);
  if (!owned) return null;

  const order = await db.order.findFirstOrThrow({
    where: { id: owned.id, ...ownerFilter(owner) },
    include: {
      ...SUMMARY_INCLUDE,
      lines: {
        include: {
          fulfillmentMethod: { select: { label: true } },
          pickupLocation: { select: { name: true } },
          addOns: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      packages: {
        include: { fulfillmentMethod: { select: { label: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  const summary = toSummary({
    ...order,
    lines: order.lines.map((line) => ({
      quantity: line.quantity,
      lineTotalCents: line.lineTotalCents,
      recipientName: line.recipientName,
      addressPostalCode: line.addressPostalCode,
      addOns: line.addOns.map((addOn) => ({ lineTotalCents: addOn.lineTotalCents })),
    })),
  });

  return {
    ...summary,
    subtotalCents: order.status === 'DRAFT' ? summary.totalCents : order.subtotalCents,
    fulfillmentFeeCents: order.fulfillmentFeeCents,
    amountPaidCents: order.amountPaidCents,
    lines: order.lines.map((line) => ({
      id: line.id,
      name: line.productNameSnapshot,
      quantity: line.quantity,
      lineTotalCents: lineTotalWithAddOns(line),
      options: optionsLabel(line.optionsSnapshot),
      addOns: line.addOns.map((addOn) => addOn.addOnNameSnapshot),
      recipientName: line.recipientName,
      methodLabel: line.fulfillmentMethod?.label ?? null,
      destination: destinationOf(line),
      greetingMessage: line.greetingMessage,
    })),
    packages: order.packages.map((row) => ({
      id: row.id,
      recipientName: row.recipientName,
      stage: row.stage,
      methodLabel: row.fulfillmentMethod.label,
    })),
  };
}

function toSummary(order: SummaryRow): OrderSummary {
  const lineTotals = order.lines.map(lineTotalWithAddOns);

  const recipients = new Set(
    order.lines
      .filter((line) => line.recipientName !== null)
      .map((line) => `${line.recipientName}|${line.addressPostalCode ?? ''}`),
  );

  return {
    id: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    orderNumber: order.orderNumber,
    draftReference: order.draftReference,
    seasonLabel: order.season.label,
    itemCount: order.lines.reduce((count, line) => count + line.quantity, 0),
    recipientCount: recipients.size,
    unassignedCount: order.lines.filter((line) => line.recipientName === null).length,
    totalCents: order.status === 'DRAFT' ? sumCents(lineTotals) : order.totalCents,
    placedAt: order.placedAt,
    createdAt: order.createdAt,
  };
}

function optionsLabel(snapshot: Prisma.JsonValue): string {
  if (!Array.isArray(snapshot)) return '';

  return snapshot
    .map((entry) =>
      entry && typeof entry === 'object' && 'label' in entry ? String(entry.label) : '',
    )
    .filter(Boolean)
    .join(', ');
}

function destinationOf(line: {
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPostalCode: string | null;
  pickupLocation: { name: string } | null;
}): string | null {
  if (line.pickupLocation) return `Pick up at ${line.pickupLocation.name}`;
  if (!line.addressLine1) return null;

  return addressSummary({
    line1: line.addressLine1,
    line2: line.addressLine2,
    city: line.addressCity ?? '',
    state: line.addressState ?? '',
    postalCode: line.addressPostalCode ?? '',
  });
}
