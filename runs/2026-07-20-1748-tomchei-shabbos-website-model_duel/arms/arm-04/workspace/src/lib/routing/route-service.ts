import 'server-only';

import type { DeliveryRoute, Prisma } from '@prisma/client';

import { addressLine, toAddressParts } from '../addresses/address-mapping';
import { recordAudit, type AuditActor } from '../audit';
import { failure, ok, STALE_VERSION, type Result } from '../core/result';
import { db } from '../db';
import { boardScopeWhere } from '../fulfillment/channel-summary';
import { type OutboxResult } from '../notifications/outbox';
import { notifyDayOf } from '../scheduling/day-of-notice';
import { abort, runInTransaction } from '../transaction';
import { geocodeAddress } from './geocode';
import { orderStops, originPoint } from './route-ordering';

/**
 * Volunteer routes (UR-004, R-074, R-075, R-076).
 *
 * A route is the plan for one van on one day. Building it geocodes every box
 * once and puts the stops in a drivable order; nothing else about the box
 * changes, because a box's own progress belongs to the packing board.
 *
 * Everything here reads packages through the board's scope, so a route can never
 * pick up a box from another season or from an order nobody is working.
 *
 * Two neighbours own the parts that are not about a route's life story: the
 * driving order is `route-ordering.ts`, and the day-of message is
 * `scheduling/day-of-notice.ts` next to the other customer notices.
 */
export const ROUTE_NOT_FOUND = 'route_not_found';
export const NO_STOPS = 'route_has_no_stops';
export const ROUTE_SETTLED = 'route_already_finished';
export const STOP_NOT_ON_ROUTE = 'stop_not_on_route';

/** A box a route may pick up: going out by van, still on the table, not on a run. */
export function routableDeliveryWhere(seasonId: string): Prisma.PackageWhereInput {
  return {
    ...boardScopeWhere(seasonId),
    fulfillmentMethod: { kind: 'DELIVERY' },
    stage: { in: ['NEW', 'PRINTED', 'PACKED'] },
    routeStop: null,
  };
}

export type RouteCandidate = {
  id: string;
  recipientName: string;
  destination: string;
  deliveryDay: string | null;
  orderNumber: number | null;
  draftReference: string;
};

export async function listRouteCandidates(
  seasonId: string,
  deliveryDay: string | null,
): Promise<RouteCandidate[]> {
  const packages = await db.package.findMany({
    where: {
      ...routableDeliveryWhere(seasonId),
      ...(deliveryDay ? { deliveryDay } : {}),
    },
    include: { order: { select: { orderNumber: true, draftReference: true } } },
    orderBy: [{ addressPostalCode: 'asc' }, { recipientName: 'asc' }],
  });

  return packages.map((box) => ({
    id: box.id,
    recipientName: box.recipientName,
    destination: addressLine(box) ?? 'No address on this box',
    deliveryDay: box.deliveryDay,
    orderNumber: box.order.orderNumber,
    draftReference: box.order.draftReference,
  }));
}

export type BuiltRoute = { routeId: string; stopCount: number; unplacedCount: number };

/**
 * Builds a route from the boxes a manager ticked.
 *
 * The geocoding happens before the transaction: it talks to the network, and a
 * database transaction held open across a provider call is how a Purim-week
 * evening ends with every connection in the pool waiting on Mapbox.
 */
export async function buildRoute(
  actor: AuditActor,
  input: { seasonId: string; label: string; deliveryDay: string | null; packageIds: string[] },
): Promise<Result<BuiltRoute>> {
  if (input.label.trim() === '') return failure('route_needs_label', 'Give the route a name first.');
  if (input.packageIds.length === 0) {
    return failure(NO_STOPS, 'Tick the boxes that go on this route first.');
  }

  const packages = await db.package.findMany({
    where: { id: { in: input.packageIds }, ...routableDeliveryWhere(input.seasonId) },
  });

  if (packages.length === 0) {
    return failure(NO_STOPS, 'None of those boxes can go on a route: they are already on one, or already out.');
  }

  const placed = await Promise.all(
    packages.map(async (box) => {
      const address = toAddressParts(box);
      const answer = address ? await geocodeAddress(address) : { point: null };
      return { packageId: box.id, point: answer.point };
    }),
  );

  const ordered = orderStops(placed, await originPoint());

  const created = await runInTransaction(async (tx) => {
    const route = await tx.deliveryRoute.create({
      data: {
        seasonId: input.seasonId,
        label: input.label.trim(),
        deliveryDay: input.deliveryDay,
        stops: {
          create: ordered.map((stop, index) => ({
            packageId: stop.packageId,
            sequence: index,
            latitude: stop.point?.latitude ?? null,
            longitude: stop.point?.longitude ?? null,
          })),
        },
      },
    });

    await recordAudit(
      actor,
      {
        action: 'route.created',
        entityType: 'DeliveryRoute',
        entityId: route.id,
        detail: {
          stopCount: ordered.length,
          deliveryDay: input.deliveryDay,
          unplacedCount: ordered.filter((stop) => stop.point === null).length,
        },
      },
      tx,
    );

    return route;
  });

  if (!created.ok) return created;

  return ok({
    routeId: created.value.id,
    stopCount: ordered.length,
    unplacedCount: ordered.filter((stop) => stop.point === null).length,
  });
}

export async function assignDriver(
  actor: AuditActor,
  input: { routeId: string; seasonId: string; driverStaffUserId: string | null; expectedVersion: number },
): Promise<Result<DeliveryRoute>> {
  return runInTransaction(async (tx) => {
    const route = await tx.deliveryRoute.findFirst({
      where: { id: input.routeId, seasonId: input.seasonId },
    });

    if (!route) abort(failure(ROUTE_NOT_FOUND, 'That route is not one of this season\u2019s.'));
    if (route.status === 'COMPLETED') {
      abort(failure(ROUTE_SETTLED, 'This route is finished, so it cannot be handed to anybody else.'));
    }

    if (input.driverStaffUserId) {
      const driver = await tx.staffUser.findFirst({
        where: { id: input.driverStaffUserId, status: 'ACTIVE' },
      });
      if (!driver) abort(failure('driver_not_found', 'That driver is not an active staff member.'));
    }

    const assigned = await tx.deliveryRoute.updateMany({
      where: { id: input.routeId, version: input.expectedVersion },
      data: { driverStaffUserId: input.driverStaffUserId, version: { increment: 1 } },
    });

    if (assigned.count === 0) {
      abort(
        failure(
          STALE_VERSION,
          'Somebody else changed this route while you were looking at it. Reload and try again.',
        ),
      );
    }

    await recordAudit(
      actor,
      {
        action: 'route.driver_assigned',
        entityType: 'DeliveryRoute',
        entityId: input.routeId,
        detail: { driverStaffUserId: input.driverStaffUserId },
      },
      tx,
    );

    return tx.deliveryRoute.findUniqueOrThrow({ where: { id: input.routeId } });
  });
}

/**
 * The van pulls out (G-023).
 *
 * Starting the route is also what tells every recipient the box is coming today
 * — one notice per box, keyed on the box, so a manager who presses Start twice
 * because the first tap did not look like it worked does not text a hundred
 * families twice. Only stops still waiting are told: a box already ticked off
 * has been delivered, and telling that family it is on its way is a phone call
 * to the office.
 *
 * The notices go out first and the status change and its audit row go together
 * afterwards. Two orderings were possible and this is the one whose failure is
 * survivable: a crash between them leaves the route PLANNED and some notices
 * sent, and pressing Start again re-sends nothing (the dedupe key holds) and
 * finishes the job. The other way round can leave a route IN_PROGRESS with no
 * `route.started` row, and an audit trail with a hole in it cannot be repaired
 * by pressing a button.
 */
export async function startRoute(
  actor: AuditActor,
  input: { routeId: string; seasonId: string },
): Promise<Result<{ stopCount: number; notified: OutboxResult }>> {
  const route = await db.deliveryRoute.findFirst({
    where: { id: input.routeId, seasonId: input.seasonId },
    include: { stops: { orderBy: { sequence: 'asc' } } },
  });

  if (!route) return failure(ROUTE_NOT_FOUND, 'That route is not one of this season\u2019s.');
  if (route.status === 'COMPLETED') return failure(ROUTE_SETTLED, 'This route is already finished.');
  if (route.stops.length === 0) return failure(NO_STOPS, 'This route has no stops on it yet.');

  const notified = await notifyDayOf(
    route.id,
    route.stops.filter((stop) => stop.status === 'PENDING').map((stop) => stop.packageId),
  );

  const started = await runInTransaction(async (tx) => {
    if (route.status === 'PLANNED') {
      await tx.deliveryRoute.update({
        where: { id: route.id },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
    }

    await recordAudit(
      actor,
      {
        action: 'route.started',
        entityType: 'DeliveryRoute',
        entityId: route.id,
        detail: { stopCount: route.stops.length, notified: notified.queued },
      },
      tx,
    );

    return true;
  });

  if (!started.ok) return started;

  return ok({ stopCount: route.stops.length, notified });
}

/**
 * A stop is done.
 *
 * Two callers: the driver tapping Delivered on their phone, and the office
 * marking it from the printed sheet when the link is not an option. Both go
 * through here, so a route completed on paper leaves exactly the same trail as
 * one completed on a phone — including the audit row, which names the link when
 * there was one and says "office" when there was not.
 *
 * `seasonId` is the office's scope and is required of it, the same as every
 * other admin action. The driver passes null: their credential is the link,
 * whose row already names exactly one route, so there is no id of theirs to
 * scope.
 */
export async function markStopDelivered(
  actor: AuditActor,
  input: { routeId: string; stopId: string; linkId: string | null; seasonId: string | null },
): Promise<Result<{ remaining: number; recipientName: string; routeCompleted: boolean }>> {
  return runInTransaction(async (tx) => {
    const stop = await tx.routeStop.findFirst({
      where: {
        id: input.stopId,
        routeId: input.routeId,
        ...(input.seasonId ? { route: { seasonId: input.seasonId } } : {}),
      },
      include: { package: { select: { id: true, recipientName: true, stage: true } }, route: true },
    });

    if (!stop) abort(failure(STOP_NOT_ON_ROUTE, 'That stop is not on this route.'));
    if (stop.route.status === 'COMPLETED') {
      abort(failure(ROUTE_SETTLED, 'This route is finished. Ask the office to reopen it.'));
    }

    // A driver who taps Delivered before anybody pressed Start has started the
    // route: the van is demonstrably out. Refusing the tap would leave them
    // stuck at the kerb waiting for the office to press a button.
    if (stop.route.status === 'PLANNED') {
      await tx.deliveryRoute.update({
        where: { id: stop.routeId },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
    }

    if (stop.status !== 'DELIVERED') {
      await tx.routeStop.update({
        where: { id: stop.id },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          deliveredByLinkId: input.linkId,
        },
      });

      // The box leaving the van is the box being sent. Written straight rather
      // than through `advancePackageStage`, because the driver holds no version
      // stamp of a screen they never saw — the route stop is the lock here.
      if (stop.package.stage !== 'SENT') {
        await tx.package.update({
          where: { id: stop.packageId },
          data: { stage: 'SENT', sentAt: new Date(), version: { increment: 1 } },
        });
      }

      await recordAudit(
        actor,
        {
          action: 'route.stop_delivered',
          entityType: 'RouteStop',
          entityId: stop.id,
          detail: {
            routeId: input.routeId,
            linkId: input.linkId,
            source: input.linkId ? 'driver_link' : 'office',
          },
        },
        tx,
      );
    }

    const remaining = await tx.routeStop.count({
      where: { routeId: input.routeId, status: 'PENDING' },
    });

    if (remaining === 0) await completeRoute(tx, actor, input.routeId);

    return {
      remaining,
      recipientName: stop.package.recipientName,
      routeCompleted: remaining === 0,
    };
  });
}

/**
 * The last stop closes the route and kills the links (UR-015).
 *
 * Fifteen minutes of grace rather than an instant expiry: a driver taps the last
 * stop, drives off, and the page reloads at the next traffic light. A link that
 * died on the tap would show them a locked screen and no way to tell whether the
 * delivery registered.
 */
const LINK_GRACE_MS = 15 * 60 * 1000;

async function completeRoute(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  routeId: string,
): Promise<void> {
  const route = await tx.deliveryRoute.findUniqueOrThrow({ where: { id: routeId } });
  if (route.status === 'COMPLETED') return;

  const graceEnds = new Date(Date.now() + LINK_GRACE_MS);

  await tx.deliveryRoute.update({
    where: { id: routeId },
    data: { status: 'COMPLETED', completedAt: new Date(), version: { increment: 1 } },
  });

  await tx.driverRouteLink.updateMany({
    where: { routeId, revokedAt: null, expiresAt: { gt: graceEnds } },
    data: { expiresAt: graceEnds },
  });

  await recordAudit(
    actor,
    {
      action: 'route.completed',
      entityType: 'DeliveryRoute',
      entityId: routeId,
      detail: { stopCount: await tx.routeStop.count({ where: { routeId } }) },
    },
    tx,
  );
}

