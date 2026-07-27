import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  assignDriverAction,
  issueLinkAction,
  markStopDeliveredAction,
  rerouteOntoRouteAction,
  revokeLinkAction,
  startRouteAction,
} from '../actions';
import { BackLink } from '@/components/admin/list-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Label, Select } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { readActiveSeason } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';
import { formatDateTime } from '@/lib/core/dates';
import { db } from '@/lib/db';
import { nearbySuggestions } from '@/lib/routing/nearby-suggestions';
import { ROUTES_PATH, routeArtifactPath } from '@/lib/routing/paths';
import { readRouteForAdmin } from '@/lib/routing/route-view';

export const dynamic = 'force-dynamic';

/**
 * One van (UR-004, UR-013, UR-015, G-027).
 *
 * Everything a manager does to a route in one place: hand it to a driver, hand
 * that driver a link, print the paper fallback, tick a stop off when the driver
 * rings it in, and lift a nearby shipping box onto the van.
 */
export default async function RouteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ routeId: string }>;
  searchParams: Promise<{ notice?: string; problem?: string; linkPath?: string; linkPin?: string }>;
}) {
  const [{ routeId }, flash] = await Promise.all([params, searchParams]);
  await requirePermission('routes.manage');

  const season = await readActiveSeason();
  if (!season) notFound();

  const route = await readRouteForAdmin(routeId, season.id);
  if (!route) notFound();

  const [drivers, suggestions] = await Promise.all([
    db.staffUser.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    }),
    route.status === 'COMPLETED' ? [] : nearbySuggestions(season.id, route.id),
  ]);

  return (
    <div className="space-y-6">
      <BackLink href={ROUTES_PATH}>All routes</BackLink>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{route.label}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {route.deliveredCount}/{route.stops.length} delivered ·{' '}
            {route.driverName ?? 'no driver yet'}
            {route.deliveryDay ? ` · ${route.deliveryDay}` : ''}
            {route.startedAt ? ` · out since ${formatDateTime(route.startedAt)}` : ''}
          </p>
        </div>
        <Badge tone={route.status === 'COMPLETED' ? 'success' : 'neutral'}>
          {route.status.replace('_', ' ').toLowerCase()}
        </Badge>
      </header>

      <FlashMessages notice={flash.notice} problem={flash.problem} testIdPrefix="route" />

      {flash.linkPath ? (
        <Card data-testid="issued-link">
          <CardTitle>Send this to the driver</CardTitle>
          <CardDescription>
            The only copy. It is not stored anywhere it can be read back, so if it is lost, issue
            another one — which kills this one.
          </CardDescription>
          <p className="mt-3 break-all font-mono text-sm" data-testid="issued-link-path">
            {flash.linkPath}
          </p>
          {flash.linkPin ? (
            <p className="mt-2 text-sm" data-testid="issued-link-pin">
              PIN: <span className="font-mono font-semibold">{flash.linkPin}</span>
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <form action={startRouteAction}>
          <input type="hidden" name="routeId" value={route.id} />
          <Button type="submit" disabled={route.status === 'COMPLETED'} data-testid="start-route">
            {route.status === 'PLANNED' ? 'Start the route' : 'Send day-of notices'}
          </Button>
        </form>

        <form action={issueLinkAction} className="flex items-center gap-2">
          <input type="hidden" name="routeId" value={route.id} />
          {/* Opt out, not opt in: the URL on its own opens every household's
              name, address and phone, so the second factor is the default. */}
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="withoutPin" /> no PIN (the link alone opens the stops)
          </label>
          <Button
            type="submit"
            variant="secondary"
            disabled={route.status === 'COMPLETED'}
            data-testid="issue-link"
          >
            Issue a driver link
          </Button>
        </form>

        <form action={revokeLinkAction}>
          <input type="hidden" name="routeId" value={route.id} />
          <Button type="submit" variant="danger" data-testid="revoke-link">
            Take the link back
          </Button>
        </form>

        <Link
          href={routeArtifactPath(route.id, 'sheet')}
          className="text-sm underline underline-offset-4"
          data-testid="print-sheet"
        >
          Print the route sheet
        </Link>
        <Link
          href={routeArtifactPath(route.id, 'cards')}
          className="text-sm underline underline-offset-4"
          data-testid="print-cards"
        >
          Print this run&rsquo;s cards
        </Link>
      </div>

      <Card>
        <CardTitle>Driver</CardTitle>
        <CardDescription>
          A driver on the route is who the office rings. The link is what actually opens the stops,
          and the two are handed out separately on purpose.
        </CardDescription>

        <form action={assignDriverAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="routeId" value={route.id} />
          <input type="hidden" name="version" value={route.version} />
          <div>
            <Label htmlFor="driverStaffUserId">Assigned to</Label>
            <Select
              id="driverStaffUserId"
              name="driverStaffUserId"
              defaultValue={route.driverStaffUserId ?? ''}
            >
              <option value="">Nobody yet</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.fullName} ({driver.role.toLowerCase()})
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary" data-testid="assign-driver">
            Save driver
          </Button>
        </form>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Stops in driving order</h2>

        {route.unplacedCount > 0 ? (
          <p className="text-sm text-[var(--color-warning)]" data-testid="unplaced-warning">
            {route.unplacedCount} stop(s) could not be placed on the map and are at the end.
          </p>
        ) : null}

        <ol className="space-y-2" data-testid="stop-list">
          {route.stops.map((stop) => (
            <li
              key={stop.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
              data-testid="stop-row"
              data-stop-id={stop.id}
              data-status={stop.status}
              data-sequence={stop.sequence}
            >
              <span>
                <span className="font-medium">
                  {stop.sequence + 1}. {stop.recipientName}
                </span>
                <span className="block text-[var(--color-ink-muted)]">
                  {stop.addressLine} · {stop.itemCount} item(s) · {stop.orderLabel}
                </span>
              </span>

              <span className="flex items-center gap-3">
                {stop.status === 'DELIVERED' ? (
                  <Badge tone="success">
                    delivered{stop.deliveredAt ? ` ${formatDateTime(stop.deliveredAt)}` : ''}
                  </Badge>
                ) : (
                  <form action={markStopDeliveredAction}>
                    <input type="hidden" name="routeId" value={route.id} />
                    <input type="hidden" name="stopId" value={stop.id} />
                    <Button type="submit" variant="secondary" data-testid="office-delivered">
                      Mark delivered
                    </Button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {suggestions.length > 0 ? (
        <section className="space-y-3" data-testid="nearby-suggestions">
          <h2 className="text-lg font-semibold">Shipping boxes the van drives past</h2>
          <p className="text-sm text-[var(--color-ink-muted)]">
            Moving one onto the van cancels its carrier label. The delivery fee the customer already
            paid does not change either way.
          </p>

          <ul className="space-y-2">
            {suggestions.map((suggestion) => (
              <li
                key={suggestion.packageId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
                data-testid="suggestion-row"
                data-package-id={suggestion.packageId}
                data-miles={suggestion.milesFromStop}
              >
                <span>
                  <span className="font-medium">{suggestion.recipientName}</span>
                  <span className="block text-[var(--color-ink-muted)]">
                    {suggestion.addressLine} · {suggestion.milesFromStop} mi from{' '}
                    {suggestion.nearestStopRecipient} · {suggestion.orderLabel}
                    {suggestion.hasLiveLabel ? ' · has a live label' : ''}
                  </span>
                </span>

                <form action={rerouteOntoRouteAction} className="flex items-center gap-2">
                  <input type="hidden" name="routeId" value={route.id} />
                  <input type="hidden" name="packageId" value={suggestion.packageId} />
                  <label className="flex items-center gap-1">
                    <input type="checkbox" name="confirmed" required /> cancel the label
                  </label>
                  <Button type="submit" variant="secondary" data-testid="reroute-box">
                    Put on this van
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
