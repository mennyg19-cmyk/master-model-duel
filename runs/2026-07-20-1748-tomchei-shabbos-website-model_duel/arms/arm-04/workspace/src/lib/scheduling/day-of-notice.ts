import 'server-only';

import { db } from '../db';
import {
  addResults,
  EMPTY_OUTBOX_RESULT,
  queueCustomerMessage,
  type OutboxResult,
} from '../notifications/outbox';

/**
 * "Your box is coming today" (G-023).
 *
 * Sent when the van pulls out, once per box, whoever pressed Start and how
 * often: the dedupe key is the package, so a manager who presses Start twice
 * because the first tap did not look like it worked does not text a hundred
 * families twice.
 *
 * It sits beside `bulk-delivery.ts` rather than in the route service because it
 * is the same job as that one — telling customers when their box is coming —
 * and the two want to stay in step about what the message says.
 */
export async function notifyDayOf(routeId: string, packageIds: string[]): Promise<OutboxResult> {
  if (packageIds.length === 0) return EMPTY_OUTBOX_RESULT;

  const packages = await db.package.findMany({
    where: { id: { in: packageIds } },
    include: {
      fulfillmentMethod: { select: { label: true } },
      order: {
        select: {
          id: true,
          customer: { select: { id: true, fullName: true, email: true, normalizedPhone: true } },
        },
      },
    },
  });

  let total = EMPTY_OUTBOX_RESULT;

  for (const box of packages) {
    const customer = box.order.customer;
    if (!customer) continue;

    total = addResults(
      total,
      await queueCustomerMessage({
        kind: 'delivery.day_of',
        dedupeKey: `delivery.day_of:${box.id}`,
        email: customer.email,
        phone: customer.normalizedPhone,
        subject: `Your delivery to ${box.recipientName} is out today`,
        body:
          `A volunteer is on the road with the box for ${box.recipientName} today` +
          `${box.deliveryWindow ? `, between ${box.deliveryWindow}` : ''}. ` +
          'Nobody needs to be home to sign for it.',
        customerId: customer.id,
        orderId: box.order.id,
        packageId: box.id,
        routeId,
      }),
    );
  }

  return total;
}
