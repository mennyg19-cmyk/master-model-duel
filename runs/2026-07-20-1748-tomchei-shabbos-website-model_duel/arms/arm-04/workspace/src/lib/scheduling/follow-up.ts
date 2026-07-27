import 'server-only';

import { db } from '../db';
import { formatOrderLabel } from '../orders/order-labels';
import { readSetting } from '../settings';

/**
 * The call centre list (R-079).
 *
 * Three different phone calls, one screen, because it is the same volunteer with
 * the same headset working down a list: money that never arrived, a box on a
 * shelf nobody came for, and a delivery that was promised and has not gone. Each
 * row says which call it is and gives the number to ring.
 *
 * The filter is a real filter rather than three screens: at Purim volume the
 * unpaid list alone is hundreds of rows, and the person calling works one reason
 * at a time.
 */
export const FOLLOW_UP_REASONS = ['unpaid', 'pickup_unclaimed', 'delivery_pending'] as const;
export type FollowUpReason = (typeof FOLLOW_UP_REASONS)[number];

export const REASON_LABELS: Record<FollowUpReason, string> = {
  unpaid: 'Owes money',
  pickup_unclaimed: 'Box waiting at the counter',
  delivery_pending: 'Delivery promised, not out yet',
};

export type FollowUpFilters = { reason: FollowUpReason | null; search: string };

export type FollowUpRow = {
  orderId: string;
  orderLabel: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  reason: FollowUpReason;
  detail: string;
  owedCents: number;
  placedAt: Date | null;
};

export function readFollowUpFilters(input: { reason?: string; q?: string }): FollowUpFilters {
  const reason = (input.reason ?? '').trim();

  return {
    reason: isFollowUpReason(reason) ? reason : null,
    search: (input.q ?? '').trim().slice(0, 120),
  };
}

function isFollowUpReason(value: string): value is FollowUpReason {
  return FOLLOW_UP_REASONS.includes(value as FollowUpReason);
}

export async function readFollowUpQueue(
  seasonId: string,
  filters: FollowUpFilters,
  now: Date = new Date(),
): Promise<FollowUpRow[]> {
  const followUpDays = await readSetting('orders.followUpDays');
  const olderThan = new Date(now.getTime() - followUpDays * 24 * 60 * 60 * 1000);

  const orders = await db.order.findMany({
    where: {
      seasonId,
      status: { in: ['PLACED', 'IN_FULFILLMENT'] },
      ...(filters.search === '' ? {} : { customer: { fullName: { contains: filters.search, mode: 'insensitive' } } }),
    },
    include: {
      customer: { select: { fullName: true, phone: true, email: true } },
      packages: {
        select: {
          recipientName: true,
          stage: true,
          pickedUpAt: true,
          pickupExpiresAt: true,
          deliveryDay: true,
          fulfillmentMethod: { select: { kind: true } },
        },
      },
    },
    orderBy: { placedAt: 'asc' },
  });

  const rows: FollowUpRow[] = [];

  for (const order of orders) {
    const shared = {
      orderId: order.id,
      orderLabel: formatOrderLabel(order),
      customerName: order.customer?.fullName ?? 'Guest',
      phone: order.customer?.phone ?? null,
      email: order.customer?.email ?? null,
      owedCents: Math.max(order.totalCents - order.amountPaidCents, 0),
      placedAt: order.placedAt,
    };

    // Money first: an unpaid order is a phone call and everything else is
    // warehouse work, the same order the Today screen puts them in.
    if (
      order.paymentStatus !== 'PAID' &&
      order.paymentStatus !== 'OVERPAID' &&
      order.placedAt !== null &&
      order.placedAt <= olderThan
    ) {
      rows.push({
        ...shared,
        reason: 'unpaid',
        detail: `Placed ${order.placedAt.toDateString()} and still owes on it`,
      });
    }

    const unclaimed = order.packages.filter(
      (box) =>
        box.fulfillmentMethod.kind === 'PICKUP' &&
        box.pickedUpAt === null &&
        box.pickupExpiresAt !== null &&
        box.pickupExpiresAt <= now,
    );

    if (unclaimed.length > 0) {
      rows.push({
        ...shared,
        reason: 'pickup_unclaimed',
        detail: `${unclaimed.length} box(es) waiting: ${unclaimed.map((box) => box.recipientName).join(', ')}`,
      });
    }

    const pending = order.packages.filter(
      (box) =>
        box.fulfillmentMethod.kind === 'DELIVERY' &&
        box.stage !== 'SENT' &&
        box.deliveryDay !== null &&
        order.placedAt !== null &&
        order.placedAt <= olderThan,
    );

    if (pending.length > 0) {
      rows.push({
        ...shared,
        reason: 'delivery_pending',
        detail: `${pending.length} box(es) still on the table for ${pending[0].deliveryDay}`,
      });
    }
  }

  return filters.reason === null ? rows : rows.filter((row) => row.reason === filters.reason);
}
