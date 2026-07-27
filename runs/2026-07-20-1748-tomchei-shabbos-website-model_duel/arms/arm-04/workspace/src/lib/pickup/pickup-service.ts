import 'server-only';

import type { PackageStage, Prisma } from '@prisma/client';

import { recordAudit, type AuditActor } from '../audit';
import { failure, ok, type Result } from '../core/result';
import { runCronJobBody } from '../cron/job-run';
import { db } from '../db';
import { boardScopeWhere } from '../fulfillment/channel-summary';
import {
  addResults,
  describeOutbox,
  EMPTY_OUTBOX_RESULT,
  queueCustomerMessage,
  type OutboxResult,
} from '../notifications/outbox';
import { sumLineQuantities } from '../orders/lines';
import { formatOrderLabel } from '../orders/order-labels';

/**
 * The pickup counter (UR-010, G-017, G-026).
 *
 * A pickup box is not ready because somebody printed a slip; it is ready when
 * the food is in a box on the shelf. That is two questions, and both have to be
 * yes before anybody is told to drive over: the volunteers have packed it, and
 * every tracked item in it is still on hand. A family that comes in for a box
 * that is not there does not come back.
 *
 * After the notice the clock starts. A box nobody collects blocks a shelf and
 * spoils, so it has a deadline of its own, an unclaimed report the office works
 * from, and a nightly sweep that marks the ones that ran out.
 */
export const PICKUP_NOT_FOUND = 'pickup_package_not_found';
export const PICKUP_NOT_READY = 'pickup_not_ready';
export const PICKUP_SETTLED = 'pickup_already_collected';

/** How long a box waits on the shelf once the customer has been told (G-026). */
const PICKUP_HOLD_DAYS = 7;
export const PICKUP_EXPIRY_JOB = 'pickup.expiry-sweep';

export function pickupWhere(seasonId: string): Prisma.PackageWhereInput {
  return { ...boardScopeWhere(seasonId), fulfillmentMethod: { kind: 'PICKUP' } };
}

/**
 * Every pickup box there is, whatever season it belongs to.
 *
 * The nightly sweep is the one caller: a shelf holds last season's forgotten
 * boxes as well as this one's, and a job that only ever looked at the working
 * season would leave them unstamped forever. Screens use `pickupWhere`.
 */
function pickupWhereAllSeasons(): Prisma.PackageWhereInput {
  return { fulfillmentMethod: { kind: 'PICKUP' } };
}

export type PickupRow = {
  id: string;
  recipientName: string;
  customerName: string;
  locationName: string;
  orderLabel: string;
  itemCount: number;
  /** Everything standing between this box and a "come and get it" message. */
  blockedBy: string[];
  readyAt: Date | null;
  expiresAt: Date | null;
  pickedUpAt: Date | null;
  expiredAt: Date | null;
  version: number;
};

const PICKUP_INCLUDE = {
  pickupLocation: { select: { name: true } },
  order: { select: { orderNumber: true, draftReference: true, customer: { select: { fullName: true } } } },
  lines: {
    select: {
      quantity: true,
      productNameSnapshot: true,
      product: { select: { id: true, tracksInventory: true, inventory: true } },
    },
  },
} satisfies Prisma.PackageInclude;

export async function listPickupCounter(seasonId: string): Promise<PickupRow[]> {
  const boxes = await db.package.findMany({
    where: pickupWhere(seasonId),
    include: PICKUP_INCLUDE,
    orderBy: [{ pickedUpAt: 'asc' }, { recipientName: 'asc' }],
  });

  return boxes.map((box) => {
    const shortOf = shortLines(box.lines);

    return {
      id: box.id,
      recipientName: box.recipientName,
      customerName: box.order.customer?.fullName ?? 'Guest',
      locationName: box.pickupLocation?.name ?? 'No counter set',
      orderLabel: formatOrderLabel(box.order),
      itemCount: sumLineQuantities(box.lines),
      blockedBy: blockers(box.stage, shortOf),
      readyAt: box.pickupReadyAt,
      expiresAt: box.pickupExpiresAt,
      pickedUpAt: box.pickedUpAt,
      expiredAt: box.pickupExpiredAt,
      version: box.version,
    };
  });
}

/**
 * Whether the shelf can still cover a line. A box of untracked items — a
 * sponsorship, say — needs no stock at all and is limited only by packing.
 */
type StockLine = {
  quantity: number;
  productNameSnapshot: string;
  product: { tracksInventory: boolean; inventory: { onHand: number } | null } | null;
};

function shortLines(lines: StockLine[]): string[] {
  return lines
    .filter((line) => line.product?.tracksInventory)
    .filter((line) => (line.product?.inventory?.onHand ?? 0) < line.quantity)
    .map((line) => line.productNameSnapshot);
}

/** Packing is what puts the box on the shelf; before that there is nothing to collect. */
function isPacked(stage: PackageStage): boolean {
  return stage === 'PACKED' || stage === 'PICKED_UP';
}

function blockers(stage: PackageStage, shortOf: string[]): string[] {
  const reasons: string[] = [];

  if (!isPacked(stage)) reasons.push('not packed yet');
  if (shortOf.length > 0) reasons.push(`short of ${shortOf.join(', ')}`);

  return reasons;
}

/**
 * "Your box is on the shelf" (G-026). Sent once per box: the dedupe key is the
 * package, so a second press of the button tells the person at the counter that
 * the family already knows rather than texting them again.
 */
export async function sendPickupReady(
  actor: AuditActor,
  input: { packageId: string; seasonId: string },
): Promise<Result<{ recipientName: string; expiresAt: Date; outbox: OutboxResult; summary: string }>> {
  const box = await db.package.findFirst({
    where: { id: input.packageId, ...pickupWhere(input.seasonId) },
    include: {
      ...PICKUP_INCLUDE,
      order: {
        select: {
          id: true,
          orderNumber: true,
          draftReference: true,
          customer: { select: { id: true, fullName: true, email: true, normalizedPhone: true } },
        },
      },
    },
  });

  if (!box) return failure(PICKUP_NOT_FOUND, 'That is not a pickup box on this season\u2019s counter.');
  if (box.pickedUpAt) return failure(PICKUP_SETTLED, 'This box has already been collected.');

  const blocked = blockers(box.stage, shortLines(box.lines));
  if (blocked.length > 0) {
    return failure(
      PICKUP_NOT_READY,
      `This box is ${blocked.join(' and ')}, so nobody should be asked to come in for it yet.`,
    );
  }

  const readyAt = box.pickupReadyAt ?? new Date();
  const expiresAt =
    box.pickupExpiresAt ?? new Date(readyAt.getTime() + PICKUP_HOLD_DAYS * 24 * 60 * 60 * 1000);

  const customer = box.order.customer;
  const outbox = customer
    ? await queueCustomerMessage({
        kind: 'pickup.ready',
        dedupeKey: `pickup.ready:${box.id}`,
        email: customer.email,
        phone: customer.normalizedPhone,
        subject: `The box for ${box.recipientName} is ready to collect`,
        body:
          `The box for ${box.recipientName} is waiting at ${box.pickupLocation?.name ?? 'the office'}. ` +
          `Please collect it by ${expiresAt.toDateString()}.`,
        customerId: customer.id,
        orderId: box.order.id,
        packageId: box.id,
      })
    : EMPTY_OUTBOX_RESULT;

  await db.package.update({
    where: { id: box.id },
    data: { pickupReadyAt: readyAt, pickupExpiresAt: expiresAt },
  });

  if (outbox.queued > 0) {
    await recordAudit(actor, {
      action: 'pickup.ready_notified',
      entityType: 'Package',
      entityId: box.id,
      detail: { expiresAt: expiresAt.toISOString() },
    });
  }

  return ok({
    recipientName: box.recipientName,
    expiresAt,
    outbox,
    summary: describeOutbox(outbox),
  });
}

/**
 * The stamp at the counter: somebody took their box home.
 *
 * It has to pass the same eligibility question the "come and get it" message
 * does, because `PICKED_UP` is a stage and stages are not skippable: without
 * the gate a box still sitting at `NEW` could be stamped collected, and the
 * board would show a box that went home before anybody printed or packed it.
 *
 * A box the counter has already announced is exempt. At that point staff have
 * seen it on the shelf, and a stock count that has since drifted must not stop
 * the family in front of them being handed their own box.
 */
export async function stampPickedUp(
  actor: AuditActor,
  input: { packageId: string; seasonId: string },
): Promise<Result<{ recipientName: string }>> {
  const box = await db.package.findFirst({
    where: { id: input.packageId, ...pickupWhere(input.seasonId) },
    include: PICKUP_INCLUDE,
  });

  if (!box) return failure(PICKUP_NOT_FOUND, 'That is not a pickup box on this season\u2019s counter.');
  if (box.pickedUpAt) return failure(PICKUP_SETTLED, 'This box is already stamped as collected.');

  const blocked = box.pickupReadyAt ? [] : blockers(box.stage, shortLines(box.lines));
  if (blocked.length > 0) {
    return failure(
      PICKUP_NOT_READY,
      `This box is ${blocked.join(' and ')}, so it is not on the shelf to be handed over.`,
    );
  }

  await db.package.update({
    where: { id: box.id },
    data: {
      stage: 'PICKED_UP',
      pickedUpAt: new Date(),
      pickupExpiredAt: null,
      version: { increment: 1 },
    },
  });

  await recordAudit(actor, {
    action: 'pickup.collected',
    entityType: 'Package',
    entityId: box.id,
  });

  return ok({ recipientName: box.recipientName });
}

/** Boxes past their deadline that nobody has collected - the office's call list. */
export async function listUnclaimedPickups(seasonId: string, now: Date = new Date()) {
  return db.package.findMany({
    where: {
      ...pickupWhere(seasonId),
      pickedUpAt: null,
      pickupExpiresAt: { lte: now },
    },
    include: {
      pickupLocation: { select: { name: true } },
      order: {
        select: {
          orderNumber: true,
          draftReference: true,
          customer: { select: { fullName: true, phone: true, email: true } },
        },
      },
    },
    orderBy: { pickupExpiresAt: 'asc' },
  });
}

export type PickupExpirySummary = { expired: number };

/**
 * The nightly sweep (R-182).
 *
 * It only stamps: the box stays on the shelf and stays collectable, because a
 * family that turns up on the eighth day should be handed their box, not told a
 * cron job disposed of it. What the stamp buys is a list the office can work and
 * a number the manager can see.
 *
 * **This function authenticates nobody.** It is the job body; the route that
 * calls it checks the bearer secret first.
 */
export async function expireUnclaimedPickups(now: Date = new Date()): Promise<PickupExpirySummary> {
  return runCronJobBody(PICKUP_EXPIRY_JOB, async () => {
    const stranded = await db.package.findMany({
      where: {
        ...pickupWhereAllSeasons(),
        pickedUpAt: null,
        pickupExpiredAt: null,
        pickupExpiresAt: { lte: now },
      },
      select: { id: true, pickupExpiresAt: true },
    });

    await db.package.updateMany({
      where: { id: { in: stranded.map((box) => box.id) } },
      data: { pickupExpiredAt: now },
    });

    // One row per box, the same as the collection stamp: "when did this box stop
    // being expected" is a question the office asks about one family, not about
    // a nightly total.
    for (const box of stranded) {
      await recordAudit(null, {
        action: 'pickup.expired',
        entityType: 'Package',
        entityId: box.id,
        detail: { expiresAt: box.pickupExpiresAt?.toISOString() ?? null },
      });
    }

    return {
      value: { expired: stranded.length },
      itemsProcessed: stranded.length,
      detail: { expired: stranded.length },
    };
  });
}

/** Tells everybody whose box is genuinely ready, in one press at the counter. */
export async function sweepPickupsReady(
  actor: AuditActor,
  seasonId: string,
): Promise<{ summary: string; result: OutboxResult }> {
  const rows = await listPickupCounter(seasonId);
  let total = EMPTY_OUTBOX_RESULT;

  for (const row of rows.filter((candidate) => candidate.blockedBy.length === 0 && !candidate.pickedUpAt)) {
    const sent = await sendPickupReady(actor, { packageId: row.id, seasonId });
    if (sent.ok) total = addResults(total, sent.value.outbox);
  }

  return { summary: describeOutbox(total), result: total };
}
