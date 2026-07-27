import Link from 'next/link';

import { setSeasonScheduleAction, setSeasonStatusAction } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { formatInZone, utcToWallClock } from '@/lib/core/timezone';
import { listSeasons } from '@/lib/seasons/management';
import { readSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/**
 * The season calendar (UR-008, R-097).
 *
 * One screen answers the two questions a manager has in February: is the shop
 * taking orders, and what happens overnight if nobody is watching. The switch
 * and the schedule sit on the same card per season so it is impossible to set
 * one while reading the other.
 */
export default async function SeasonsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  await requirePermission('seasons.manage');
  const [flash, seasons, timeZone] = await Promise.all([
    searchParams,
    listSeasons(),
    readSetting('store.timezone'),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Seasons</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">
            Times are {timeZone}. Only one season is open at a time; opening one closes the other.
            The archive stays readable whatever is open.
          </p>
        </div>
        <Link href="/admin/seasons/new">
          <Button data-testid="start-season-wizard">Start a new season</Button>
        </Link>
      </header>

      <FlashMessages notice={flash.notice} problem={flash.problem} testIdPrefix="seasons" />

      {seasons.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid="seasons-empty">
          No seasons yet. The wizard makes the first one.
        </p>
      ) : null}

      {seasons.map((season) => (
        <Card key={season.id} data-testid="season-card" data-year={season.year}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>
                {season.label}{' '}
                <Badge tone={season.status === 'OPEN' ? 'success' : 'neutral'}>{season.status}</Badge>
              </CardTitle>
              <CardDescription>
                {season.productCount} product{season.productCount === 1 ? '' : 's'} ·{' '}
                {season.orderCount} order{season.orderCount === 1 ? '' : 's'}
              </CardDescription>
            </div>

            <form action={setSeasonStatusAction}>
              <input type="hidden" name="seasonId" value={season.id} />
              <input type="hidden" name="to" value={season.status === 'OPEN' ? 'CLOSED' : 'OPEN'} />
              <Button type="submit" variant="secondary" data-testid="season-flip">
                {season.status === 'OPEN' ? 'Close this season' : 'Open this season'}
              </Button>
            </form>
          </div>

          <form
            action={setSeasonScheduleAction}
            className="mt-4 grid gap-3 sm:grid-cols-3 sm:items-end"
            data-testid="season-schedule"
          >
            <input type="hidden" name="seasonId" value={season.id} />
            <div>
              <Label htmlFor={`opensAt-${season.id}`}>Opens automatically</Label>
              <Input
                id={`opensAt-${season.id}`}
                name="opensAt"
                type="datetime-local"
                defaultValue={season.opensAt ? utcToWallClock(season.opensAt, timeZone) : ''}
              />
            </div>
            <div>
              <Label htmlFor={`closesAt-${season.id}`}>Closes automatically</Label>
              <Input
                id={`closesAt-${season.id}`}
                name="closesAt"
                type="datetime-local"
                defaultValue={season.closesAt ? utcToWallClock(season.closesAt, timeZone) : ''}
              />
            </div>
            <Button type="submit" variant="secondary">
              Save schedule
            </Button>
          </form>

          <p className="mt-2 text-sm text-[var(--color-ink-muted)]" data-testid="season-schedule-summary">
            {scheduleSummary(season.opensAt, season.closesAt, timeZone)}
          </p>
        </Card>
      ))}
    </div>
  );
}

function scheduleSummary(opensAt: Date | null, closesAt: Date | null, timeZone: string): string {
  if (!opensAt && !closesAt) return 'No schedule: this season only moves when you press the button.';

  return [
    opensAt ? `Opens ${formatInZone(opensAt, timeZone)}` : 'Opens by hand',
    closesAt ? `closes ${formatInZone(closesAt, timeZone)}` : 'closes by hand',
  ].join(', ');
}
