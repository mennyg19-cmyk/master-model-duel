import 'server-only';

import { randomUUID } from 'node:crypto';

import { recordAudit, type AuditActor } from '../audit';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { boardScopeWhere } from '../fulfillment/channel-summary';
import {
  addResults,
  describeOutbox,
  EMPTY_OUTBOX_RESULT,
  queueCustomerMessage,
  type OutboxResult,
} from '../notifications/outbox';

/**
 * The office setting a delivery day and window over a stack of boxes (G-021).
 *
 * One notice per customer, not per box: a donor with fourteen boxes on Sunday
 * gets one message that says fourteen, because fourteen texts is how a charity
 * loses a donor. The dedupe key is the customer and the slot they were told, so
 * rescheduling to a different window does send a fresh message and pressing the
 * button twice on the same one does not.
 */
export const NOTHING_TO_SCHEDULE = 'nothing_to_schedule';
export const MAX_WINDOW_LENGTH = 60;

export type BulkScheduleSummary = {
  batchId: string;
  packageCount: number;
  customerCount: number;
  outbox: OutboxResult;
  summary: string;
};

export async function scheduleBulkDelivery(
  actor: AuditActor,
  input: {
    seasonId: string;
    packageIds: string[];
    deliveryDay: string;
    deliveryWindow: string;
  },
): Promise<Result<BulkScheduleSummary>> {
  const deliveryDay = input.deliveryDay.trim();
  const deliveryWindow = input.deliveryWindow.trim();

  if (deliveryDay === '') return failure('delivery_day_required', 'Pick the day this run goes out.');
  if (deliveryWindow.length > MAX_WINDOW_LENGTH) {
    return failure('delivery_window_too_long', `Keep the window under ${MAX_WINDOW_LENGTH} characters.`);
  }

  const boxes = await db.package.findMany({
    where: {
      id: { in: input.packageIds },
      ...boardScopeWhere(input.seasonId),
      fulfillmentMethod: { kind: 'DELIVERY' },
      stage: { in: ['NEW', 'PRINTED', 'PACKED'] },
    },
    include: {
      order: {
        select: {
          id: true,
          customer: { select: { id: true, fullName: true, email: true, normalizedPhone: true } },
        },
      },
    },
  });

  if (boxes.length === 0) {
    return failure(
      NOTHING_TO_SCHEDULE,
      'None of those boxes can be scheduled: they are not delivery boxes, or they have already gone out.',
    );
  }

  await db.package.updateMany({
    where: { id: { in: boxes.map((box) => box.id) } },
    data: { deliveryDay, deliveryWindow },
  });

  const byCustomer = new Map<string, { boxes: typeof boxes; orderId: string }>();

  for (const box of boxes) {
    const customer = box.order.customer;
    if (!customer) continue;

    const existing = byCustomer.get(customer.id);
    if (existing) existing.boxes.push(box);
    else byCustomer.set(customer.id, { boxes: [box], orderId: box.order.id });
  }

  let outbox = EMPTY_OUTBOX_RESULT;

  for (const [customerId, group] of byCustomer) {
    const customer = group.boxes[0].order.customer;
    if (!customer) continue;

    const count = group.boxes.length;

    outbox = addResults(
      outbox,
      await queueCustomerMessage({
        kind: 'delivery.bulk_scheduled',
        dedupeKey: `delivery.scheduled:${customerId}:${deliveryDay}:${deliveryWindow}`,
        email: customer.email,
        phone: customer.normalizedPhone,
        subject: `Your ${count === 1 ? 'delivery is' : 'deliveries are'} set for ${deliveryDay}`,
        body:
          `${count} box${count === 1 ? '' : 'es'} you ordered will be delivered on ${deliveryDay}` +
          `${deliveryWindow === '' ? '' : `, between ${deliveryWindow}`}. Nobody needs to be home.`,
        customerId,
        orderId: group.orderId,
      }),
    );
  }

  const batchId = randomUUID();

  await recordAudit(actor, {
    action: 'delivery.bulk_scheduled',
    entityType: 'Package',
    entityId: batchId,
    detail: {
      batchId,
      packageCount: boxes.length,
      customerCount: byCustomer.size,
      deliveryDay,
      deliveryWindow,
    },
  });

  return ok({
    batchId,
    packageCount: boxes.length,
    customerCount: byCustomer.size,
    outbox,
    summary: describeOutbox(outbox),
  });
}
