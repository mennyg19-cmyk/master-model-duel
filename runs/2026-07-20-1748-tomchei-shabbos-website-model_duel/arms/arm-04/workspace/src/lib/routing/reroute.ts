import 'server-only';

import type { Prisma } from '@prisma/client';

import { toAddressParts } from '../addresses/address-mapping';
import { recordAudit, type AuditActor } from '../audit';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { switchFulfillmentMethod, type MethodSwitch } from '../fulfillment/method-switch';
import { runInTransaction } from '../transaction';
import { geocodeAddress, type GeocodePoint } from './geocode';
import { forgetNearbySuggestions, nearbySuggestions } from './nearby-suggestions';

/**
 * Lifting a nearby shipping box onto a van (UR-004, G-023, G-027).
 *
 * Three things have to be true before a bought label is cancelled, and all
 * three are checked here rather than on the screen that offered the box:
 *
 * 1. **The route is still running.** A finished van cannot pick anything up.
 * 2. **The van really is passing.** The suggestion list is advisory and arrives
 *    back as a form post, so the distance is re-established server-side. A
 *    hand-written post naming any box and any route is otherwise a way to move
 *    somebody's parcel across the county onto a van that will never reach it.
 * 3. **A manager said yes to this box.** `confirmed` is a real argument rather
 *    than a convention, because the yes is what cancels the carrier label.
 *
 * What happens to the box itself — the fee, the label, the lines — belongs to
 * `fulfillment/method-switch.ts`, which the office's own switch screen shares.
 */
export const NEEDS_CONFIRMATION = 'reroute_not_confirmed';
export const NOT_NEARBY = 'reroute_box_not_nearby';

export async function rerouteOntoRoute(
  actor: AuditActor,
  input: {
    routeId: string;
    packageId: string;
    seasonId: string;
    toMethodId: string;
    expectedVersion: number;
    confirmed: boolean;
  },
): Promise<Result<MethodSwitch & { routeId: string; milesFromStop: number }>> {
  if (!input.confirmed) {
    return failure(NEEDS_CONFIRMATION, 'Tick the confirmation before a box is taken off the carrier.');
  }

  const route = await db.deliveryRoute.findFirst({
    where: { id: input.routeId, seasonId: input.seasonId },
  });

  if (!route) return failure('route_not_found', 'That route is not one of this season\u2019s.');
  if (route.status === 'COMPLETED') {
    return failure('route_already_finished', 'This route is finished, so nothing more can be added to it.');
  }

  const suggestion = (await nearbySuggestions(input.seasonId, input.routeId)).find(
    (candidate) => candidate.packageId === input.packageId,
  );

  if (!suggestion) {
    return failure(
      NOT_NEARBY,
      'This van is not passing that box, so it stays with the carrier. Reload the route and try again.',
    );
  }

  const switched = await switchFulfillmentMethod(actor, {
    packageId: input.packageId,
    seasonId: input.seasonId,
    toMethodId: input.toMethodId,
    expectedVersion: input.expectedVersion,
    reason: `Rerouted onto ${route.label}`,
  });

  if (!switched.ok) return switched;

  const box = await db.package.findUniqueOrThrow({ where: { id: input.packageId } });
  const address = toAddressParts(box);
  const point = address ? (await geocodeAddress(address)).point : null;

  const added = await runInTransaction(async (tx) => {
    await appendStop(tx, { routeId: input.routeId, packageId: input.packageId, point });

    await recordAudit(
      actor,
      {
        action: 'package.rerouted',
        entityType: 'Package',
        entityId: input.packageId,
        detail: {
          routeId: input.routeId,
          labelVoided: switched.value.labelVoided,
          milesFromStop: suggestion.milesFromStop,
        },
      },
      tx,
    );

    return true;
  });

  if (!added.ok) return added;

  forgetNearbySuggestions(input.routeId);

  return ok({ ...switched.value, routeId: input.routeId, milesFromStop: suggestion.milesFromStop });
}

/** Adds one box to a route as its last stop. The reroute above is the only caller. */
async function appendStop(
  tx: Prisma.TransactionClient,
  input: { routeId: string; packageId: string; point: GeocodePoint | null },
): Promise<void> {
  // Two managers rerouting onto the same van at the same moment would each read
  // the same last sequence and the second create would hit `@@unique([routeId,
  // sequence])`. The lock on the route is what makes the second one queue.
  await tx.$queryRaw`SELECT id FROM "DeliveryRoute" WHERE id = ${input.routeId} FOR UPDATE`;

  const last = await tx.routeStop.aggregate({
    where: { routeId: input.routeId },
    _max: { sequence: true },
  });

  await tx.routeStop.create({
    data: {
      routeId: input.routeId,
      packageId: input.packageId,
      sequence: (last._max.sequence ?? -1) + 1,
      latitude: input.point?.latitude ?? null,
      longitude: input.point?.longitude ?? null,
    },
  });
}
