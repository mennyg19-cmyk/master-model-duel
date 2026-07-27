import Link from 'next/link';

import { planCandidatesAction } from './actions';
import { NoSeason } from '@/components/admin/no-season';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { readActiveSeason } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';
import { geocodeProviderName } from '@/lib/routing/geocode';
import { routePath } from '@/lib/routing/paths';
import { listRouteCandidates } from '@/lib/routing/route-service';
import { listRoutes } from '@/lib/routing/route-view';
import { readSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/**
 * Route planning (UR-004, R-074, G-021).
 *
 * One screen because it is one job: the manager sees the boxes waiting for a
 * van, ticks the ones that go out together, and either builds a route out of
 * them or just tells those customers which day they are coming. The list of
 * routes above it is the night's status board.
 */
export default async function RoutesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; problem?: string; day?: string }>;
}) {
  const [params] = await Promise.all([searchParams, requirePermission('routes.manage')]);
  const season = await readActiveSeason();

  if (!season) {
    return (
      <NoSeason
        title="Routes"
        message="There is no season yet, so there is nothing to drive."
        testId="routes-no-season"
      />
    );
  }

  const day = (params.day ?? '').trim();
  const [routes, candidates, deliveryDays] = await Promise.all([
    listRoutes(season.id),
    listRouteCandidates(season.id, day === '' ? null : day),
    readSetting('delivery.dayChoices'),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Routes</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {season.label} · addresses placed by {geocodeProviderName()}
        </p>
      </header>

      <FlashMessages notice={params.notice} problem={params.problem} testIdPrefix="routes" />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Tonight&rsquo;s vans</h2>

        {routes.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]" data-testid="routes-empty">
            No route has been planned yet.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="route-list">
            {routes.map((route) => (
              <li
                key={route.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
                data-testid="route-row"
                data-route-id={route.id}
                data-status={route.status}
                data-stops={route.stopCount}
                data-delivered={route.deliveredCount}
              >
                <span className="flex items-center gap-2">
                  <Link
                    href={routePath(route.id)}
                    className="text-[var(--color-brand)] underline underline-offset-4"
                  >
                    {route.label}
                  </Link>
                  <Badge tone={route.status === 'COMPLETED' ? 'success' : 'neutral'}>
                    {route.status.replace('_', ' ').toLowerCase()}
                  </Badge>
                  {route.hasLiveLink ? <Badge tone="warning">link live</Badge> : null}
                </span>
                <span className="text-[var(--color-ink-muted)]">
                  {route.deliveredCount}/{route.stopCount} delivered ·{' '}
                  {route.driverName ?? 'no driver yet'}
                  {route.deliveryDay ? ` · ${route.deliveryDay}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Boxes waiting for a van ({candidates.length})</h2>

        <form className="flex flex-wrap items-end gap-3" data-testid="day-filter">
          <div>
            <Label htmlFor="day">Delivery day</Label>
            <Select id="day" name="day" defaultValue={day}>
              <option value="">Every day</option>
              {deliveryDays.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>

        {candidates.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]" data-testid="candidates-empty">
            Every delivery box is already on a route.
          </p>
        ) : (
          <form action={planCandidatesAction} className="space-y-4">
            <table className="w-full text-sm" data-testid="candidate-table">
              <thead className="text-left text-[var(--color-ink-muted)]">
                <tr>
                  <th className="py-2 w-8"></th>
                  <th>Recipient</th>
                  <th>Where</th>
                  <th>Day</th>
                  <th>Order</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr
                    key={candidate.id}
                    className="border-t border-[var(--color-line)]"
                    data-testid="candidate-row"
                    data-package-id={candidate.id}
                  >
                    <td className="py-2">
                      <input
                        type="checkbox"
                        name="packageIds"
                        value={candidate.id}
                        aria-label={`Put ${candidate.recipientName} on this route`}
                      />
                    </td>
                    <td>{candidate.recipientName}</td>
                    <td className="text-[var(--color-ink-muted)]">{candidate.destination}</td>
                    <td>{candidate.deliveryDay ?? '—'}</td>
                    <td className="text-[var(--color-ink-muted)]">
                      {candidate.orderNumber === null
                        ? candidate.draftReference
                        : `#${candidate.orderNumber}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Card>
              <CardTitle>Build a route from the ticked boxes</CardTitle>
              <CardDescription>
                Every address is placed on the map once and the stops come back in driving order
                from the shipping room. Anything that could not be placed goes last so the driver
                deals with it on the phone.
              </CardDescription>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div>
                  <Label htmlFor="label">Route name</Label>
                  <Input id="label" name="label" placeholder="Sunday van 1" required />
                </div>
                <div>
                  <Label htmlFor="deliveryDay">Day</Label>
                  <Select id="deliveryDay" name="deliveryDay" defaultValue={day}>
                    <option value="">Not set</option>
                    {deliveryDays.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="submit" name="intent" value="build" data-testid="build-route">
                  Build route
                </Button>
              </div>
            </Card>

            <Card data-testid="bulk-schedule">
              <CardTitle>Or just tell them which day</CardTitle>
              <CardDescription>
                Sets the day and window on the ticked boxes and sends one message per customer, not
                one per box.
              </CardDescription>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div>
                  <Label htmlFor="bulkDay">Day</Label>
                  <Select
                    id="bulkDay"
                    name="bulkDeliveryDay"
                    defaultValue={day || deliveryDays[0] || ''}
                  >
                    {deliveryDays.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="deliveryWindow">Window</Label>
                  <Input id="deliveryWindow" name="deliveryWindow" placeholder="10am and 2pm" />
                </div>
                <Button
                  type="submit"
                  variant="secondary"
                  name="intent"
                  value="schedule"
                  data-testid="schedule-bulk"
                >
                  Schedule and tell them
                </Button>
              </div>
            </Card>
          </form>
        )}
      </section>
    </div>
  );
}
