import 'server-only';

import type { FulfillmentKind } from '@prisma/client';

import { recordAudit, type AuditActor } from '../audit';
import { failure, ok, STALE_VERSION, type Result } from '../core/result';
import { db } from '../db';
import { isActiveLabel } from '../shipping/label-status';
import { voidLabelForPackage, NO_LABEL } from '../shipping/label-service';
import { abort, runInTransaction } from '../transaction';
import { boardScopeWhere } from './channel-summary';

/**
 * Changing how one box travels (UR-002, G-005, G-028).
 *
 * Two doors reach it: the office switching a box by hand from the package
 * screen, and the route map lifting one onto a passing van (`routing/reroute`).
 * Both end in the same three steps, in this order:
 *
 * 1. **The charge does not move.** `fulfillmentFeeCents` is what the customer
 *    agreed to pay (G-028). Rerouting is an operations decision made after the
 *    money was taken, so re-pricing here would either refund somebody who never
 *    asked or bill them for a van they did not order.
 * 2. **A live label dies first**, through the P8 void hook, and only while the
 *    box is still on the table. A box already marked Sent refuses the whole
 *    switch rather than being quietly moved with a live label at the carrier.
 * 3. **Somebody says yes.** Whoever calls this has already taken that decision;
 *    the suggestion-and-confirm dance belongs to the caller.
 */
export const METHOD_NOT_FOUND = 'fulfillment_method_not_found';
export const PACKAGE_NOT_SWITCHABLE = 'package_not_switchable';
export const SWITCH_POINTLESS = 'package_already_on_that_method';

export type MethodSwitch = {
  packageId: string;
  fromMethodLabel: string;
  toMethodLabel: string;
  feeCents: number;
  labelVoided: boolean;
  voidNote: string;
};

const SWITCHABLE_KINDS: FulfillmentKind[] = ['SHIPPING', 'DELIVERY'];

export async function switchFulfillmentMethod(
  actor: AuditActor,
  input: {
    packageId: string;
    seasonId: string;
    toMethodId: string;
    expectedVersion: number;
    reason: string;
  },
): Promise<Result<MethodSwitch>> {
  const box = await db.package.findFirst({
    where: { id: input.packageId, ...boardScopeWhere(input.seasonId) },
    include: {
      fulfillmentMethod: true,
      shipmentBoxes: true,
      routeStop: { select: { id: true, routeId: true } },
    },
  });

  if (!box) return failure(PACKAGE_NOT_SWITCHABLE, 'That package is not on the packing board for this season.');

  if (box.stage === 'SENT' || box.stage === 'PICKED_UP') {
    return failure(
      PACKAGE_NOT_SWITCHABLE,
      'This box has already left, so how it travels can no longer be changed.',
    );
  }

  const target = await db.fulfillmentMethod.findFirst({
    where: { id: input.toMethodId, isActive: true },
  });

  if (!target) return failure(METHOD_NOT_FOUND, 'That is not a fulfillment method boxes can be moved to.');
  if (target.id === box.fulfillmentMethodId) {
    return failure(SWITCH_POINTLESS, `This box already goes by ${target.label}.`);
  }

  if (!SWITCHABLE_KINDS.includes(target.kind) || !SWITCHABLE_KINDS.includes(box.fulfillmentMethod.kind)) {
    return failure(
      PACKAGE_NOT_SWITCHABLE,
      'Only shipping and delivery can be swapped here. A pickup box is changed on the order.',
    );
  }

  if (target.requiresAddress && !box.addressLine1) {
    return failure(PACKAGE_NOT_SWITCHABLE, 'This box has no street address, so it cannot be delivered.');
  }

  // The carrier is called before the switch, and outside any transaction: a
  // database transaction held open across a network call is how an evening ends
  // with the connection pool waiting on a carrier. If the switch below then
  // fails, the box is still shipping with no label — recoverable by buying
  // again, which is the safer of the two ways to be wrong.
  const hadLiveLabel = box.shipmentBoxes.some((parcel) => isActiveLabel(parcel.status));
  let voidNote = '';

  if (hadLiveLabel) {
    const voided = await voidLabelForPackage(db, actor, {
      packageId: box.id,
      seasonId: input.seasonId,
      reason: input.reason,
    });

    if (!voided.ok && voided.code !== NO_LABEL) return voided;
    if (voided.ok) voidNote = `${voided.value.carrier} label cancelled. ${voided.value.note}`;
  }

  const switched = await runInTransaction(async (tx) => {
    const moved = await tx.package.updateMany({
      where: { id: box.id, version: input.expectedVersion },
      data: {
        fulfillmentMethodId: target.id,
        // The fee is deliberately absent from this update: the snapshot on the
        // box is the number the customer agreed to (G-028).
        pickupLocationId: target.requiresPickupLocation ? box.pickupLocationId : null,
        version: { increment: 1 },
      },
    });

    if (moved.count === 0) {
      abort(
        failure(STALE_VERSION, 'Somebody else changed this box while you were looking at it. Reload and try again.'),
      );
    }

    // The lines carry the method too, because grouping keys are built from them.
    await tx.orderLine.updateMany({
      where: { packageId: box.id },
      data: { fulfillmentMethodId: target.id },
    });

    // A box that is no longer delivered has no business on a van.
    if (target.kind !== 'DELIVERY' && box.routeStop) {
      await tx.routeStop.delete({ where: { id: box.routeStop.id } });
    }

    await recordAudit(
      actor,
      {
        action: 'package.method_switched',
        entityType: 'Package',
        entityId: box.id,
        detail: {
          fromMethodCode: box.fulfillmentMethod.code,
          toMethodCode: target.code,
          feeCents: box.fulfillmentFeeCents,
          labelVoided: hadLiveLabel,
        },
      },
      tx,
    );

    return true;
  });

  if (!switched.ok) return switched;

  return ok({
    packageId: box.id,
    fromMethodLabel: box.fulfillmentMethod.label,
    toMethodLabel: target.label,
    feeCents: box.fulfillmentFeeCents,
    labelVoided: hadLiveLabel,
    voidNote,
  });
}
