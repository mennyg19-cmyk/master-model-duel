'use server';

import { revalidatePath } from 'next/cache';

import { requireWorkingSeasonOrRedirect } from '@/lib/admin/working-season';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { readVersionStamp, trimmedField } from '@/lib/forms/form-data';
import { switchFulfillmentMethod } from '@/lib/fulfillment/method-switch';
import { describeOutbox } from '@/lib/notifications/outbox';
import { driverRoutePath, ROUTES_PATH, routePath } from '@/lib/routing/paths';
import { rerouteOntoRoute } from '@/lib/routing/reroute';
import { issueRouteLink, revokeRouteLink } from '@/lib/routing/route-links';
import {
  assignDriver,
  buildRoute,
  markStopDelivered,
  startRoute,
} from '@/lib/routing/route-service';
import { scheduleBulkDelivery } from '@/lib/scheduling/bulk-delivery';

/**
 * The office side of a van (UR-004, G-021, G-023, G-027).
 *
 * Planning a route is `routes.manage`; driving one is `routes.drive` and happens
 * on a magic link with no staff account behind it at all. Every action here
 * names the season, so a route id typed into a form cannot reach last year's.
 */
const STALE_SCREEN = 'This screen is out of date. Reload the route and try again.';

/**
 * The ticked boxes can go two ways: onto a van, or just into a day and window
 * with a message to the customer. Both read the same checkboxes, so they are
 * one form with two submit buttons and the pressed button says which (G-021).
 */
export async function planCandidatesAction(formData: FormData): Promise<void> {
  if (trimmedField(formData, 'intent') === 'schedule') {
    await scheduleBulkFromForm(formData);
    return;
  }

  await buildRouteAction(formData);
}

async function buildRouteAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('routes.manage');
  const seasonId = await workingSeasonId();

  const built = await buildRoute(staff, {
    seasonId,
    label: trimmedField(formData, 'label'),
    deliveryDay: trimmedField(formData, 'deliveryDay') || null,
    packageIds: formData.getAll('packageIds').map(String),
  });

  if (!built.ok) problemAtRoutesHub(built.publicMessage);

  revalidatePath(ROUTES_PATH);
  redirectWithFlash(routePath(built.value.routeId), {
    notice:
      `${built.value.stopCount} stop${built.value.stopCount === 1 ? '' : 's'} put in driving order.` +
      (built.value.unplacedCount > 0
        ? ` ${built.value.unplacedCount} could not be placed on the map and are last.`
        : ''),
  });
}

export async function assignDriverAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('routes.manage');
  const routeId = trimmedField(formData, 'routeId');

  const expectedVersion = readVersionStamp(formData);
  if (expectedVersion === null) problemAtRoute(routeId, STALE_SCREEN);

  const assigned = await assignDriver(staff, {
    routeId,
    seasonId: await workingSeasonId(),
    driverStaffUserId: trimmedField(formData, 'driverStaffUserId') || null,
    expectedVersion,
  });

  if (!assigned.ok) problemAtRoute(routeId, assigned.publicMessage);

  noticeAtRoute(
    routeId,
    assigned.value.driverStaffUserId ? 'Driver assigned.' : 'Driver taken off this route.',
  );
}

export async function startRouteAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('routes.manage');
  const routeId = trimmedField(formData, 'routeId');

  const started = await startRoute(staff, { routeId, seasonId: await workingSeasonId() });
  if (!started.ok) problemAtRoute(routeId, started.publicMessage);

  noticeAtRoute(
    routeId,
    `The van is out with ${started.value.stopCount} stop${started.value.stopCount === 1 ? '' : 's'}. ` +
      `Day-of notices: ${describeOutbox(started.value.notified)}.`,
  );
}

/**
 * The token is shown once, in the flash line, and never stored anywhere it can
 * be read back — the database keeps only its hash. A manager who loses it
 * reissues, which retires the old link in the same breath.
 */
export async function issueLinkAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('routes.manage');
  const routeId = trimmedField(formData, 'routeId');

  const issued = await issueRouteLink(staff, {
    routeId,
    seasonId: await workingSeasonId(),
    withPin: trimmedField(formData, 'withoutPin') !== 'on',
  });

  if (!issued.ok) problemAtRoute(routeId, issued.publicMessage);

  noticeAtRoute(routeId, 'A new driver link is ready. Copy it now — it is not shown again.', {
    linkPath: driverRoutePath(issued.value.token),
    linkPin: issued.value.pin ?? '',
  });
}

export async function revokeLinkAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('routes.manage');
  const routeId = trimmedField(formData, 'routeId');

  const revoked = await revokeRouteLink(staff, { routeId, seasonId: await workingSeasonId() });
  if (!revoked.ok) problemAtRoute(routeId, revoked.publicMessage);

  noticeAtRoute(routeId, 'That link is dead. The driver will need a new one.');
}

/** The office ticking off a stop from the printed sheet (R-076). */
export async function markStopDeliveredAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('routes.manage');
  const routeId = trimmedField(formData, 'routeId');

  const delivered = await markStopDelivered(staff, {
    routeId,
    stopId: trimmedField(formData, 'stopId'),
    linkId: null,
    seasonId: await workingSeasonId(),
  });

  if (!delivered.ok) problemAtRoute(routeId, delivered.publicMessage);

  noticeAtRoute(
    routeId,
    delivered.value.routeCompleted
      ? `${delivered.value.recipientName} delivered. That was the last stop, so the route is closed.`
      : `${delivered.value.recipientName} delivered. ${delivered.value.remaining} to go.`,
  );
}

/**
 * Lifting a shipping box onto a van that is passing the door (G-027). The
 * confirmation tick is what cancels a bought label, so it is required here and
 * again inside the service.
 */
export async function rerouteOntoRouteAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('routes.manage');
  const routeId = trimmedField(formData, 'routeId');
  const packageId = trimmedField(formData, 'packageId');

  const box = await db.package.findUnique({ where: { id: packageId }, select: { version: true } });
  if (!box) problemAtRoute(routeId, 'That box is no longer on the board.');

  const method = await deliveryMethodId();
  if (method === null) problemAtRoute(routeId, 'There is no delivery method set up to move boxes onto.');

  const moved = await rerouteOntoRoute(staff, {
    routeId,
    packageId,
    seasonId: await workingSeasonId(),
    toMethodId: method,
    expectedVersion: box.version,
    confirmed: trimmedField(formData, 'confirmed') === 'on',
  });

  if (!moved.ok) problemAtRoute(routeId, moved.publicMessage);

  noticeAtRoute(
    routeId,
    `Added to the van, ${moved.value.milesFromStop} miles from the nearest stop. ` +
      (moved.value.labelVoided ? moved.value.voidNote : 'There was no label to cancel.') +
      ' The delivery fee the customer paid has not changed.',
  );
}

/** Switching one box by hand from the package screen (UR-002, G-005). */
export async function switchMethodAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('fulfillment.manage');
  const packageId = trimmedField(formData, 'packageId');
  const packagePath = `/admin/fulfillment/packages/${packageId}`;

  const expectedVersion = readVersionStamp(formData);
  if (expectedVersion === null) redirectWithFlash(packagePath, { problem: STALE_SCREEN });

  const switched = await switchFulfillmentMethod(staff, {
    packageId,
    seasonId: await workingSeasonId(),
    toMethodId: trimmedField(formData, 'toMethodId'),
    expectedVersion,
    reason: trimmedField(formData, 'reason') || 'Fulfillment method changed by the office',
  });

  if (!switched.ok) redirectWithFlash(packagePath, { problem: switched.publicMessage });

  revalidatePath(packagePath);
  redirectWithFlash(packagePath, {
    notice:
      `Now going by ${switched.value.toMethodLabel} instead of ${switched.value.fromMethodLabel}. ` +
      (switched.value.labelVoided ? switched.value.voidNote : 'There was no label to cancel.') +
      ' The fee on the box is unchanged.',
  });
}

/**
 * One day and window over a stack of boxes, one message per customer (G-021).
 * The day field is its own name because the route builder in the same form has
 * a day of its own, and a browser would send both under one name.
 */
async function scheduleBulkFromForm(formData: FormData): Promise<void> {
  const staff = await requirePermission('routes.manage');

  const scheduled = await scheduleBulkDelivery(staff, {
    seasonId: await workingSeasonId(),
    packageIds: formData.getAll('packageIds').map(String),
    deliveryDay: trimmedField(formData, 'bulkDeliveryDay'),
    deliveryWindow: trimmedField(formData, 'deliveryWindow'),
  });

  if (!scheduled.ok) problemAtRoutesHub(scheduled.publicMessage);

  const { packageCount, customerCount, summary } = scheduled.value;

  revalidatePath(ROUTES_PATH);
  redirectWithFlash(ROUTES_PATH, {
    notice:
      `${packageCount} box${packageCount === 1 ? '' : 'es'} scheduled for ${customerCount} ` +
      `customer${customerCount === 1 ? '' : 's'}. ${summary}.`,
  });
}

/** The method a rerouted box moves onto: the active delivery channel. */
async function deliveryMethodId(): Promise<string | null> {
  const method = await db.fulfillmentMethod.findFirst({
    where: { kind: 'DELIVERY', isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  return method?.id ?? null;
}

function workingSeasonId(): Promise<string> {
  return requireWorkingSeasonOrRedirect(ROUTES_PATH, 'There is no season to plan routes for yet.');
}

function noticeAtRoute(routeId: string, notice: string, extra: Record<string, string> = {}): never {
  revalidatePath(routePath(routeId));
  redirectWithFlash(routePath(routeId), { notice, ...extra });
}

function problemAtRoute(routeId: string, problem: string): never {
  redirectWithFlash(routePath(routeId), { problem });
}

function problemAtRoutesHub(problem: string): never {
  redirectWithFlash(ROUTES_PATH, { problem });
}
