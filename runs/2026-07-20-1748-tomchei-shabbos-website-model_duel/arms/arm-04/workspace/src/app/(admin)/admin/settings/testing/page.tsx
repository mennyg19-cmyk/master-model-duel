import {
  resetSeasonAction,
  seedTestDataAction,
  setTestModeAction,
  wipeTestDataAction,
} from './actions';
import { SettingsTabs } from '../settings-tabs';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import { isTestMode } from '@/lib/testing/test-mode';

export const dynamic = 'force-dynamic';

/**
 * The dress rehearsal console (R-014, R-101, R-103).
 *
 * The switch at the top is what makes the rest of the page live. With test mode
 * off the buttons are disabled here and refused in the service behind them, so
 * a hand-written POST gets the same answer the screen gives.
 */
export default async function TestingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  const [params] = await Promise.all([searchParams, requirePermission('settings.manage')]);

  const [testMode, seasons] = await Promise.all([
    isTestMode(),
    db.season.findMany({ orderBy: { year: 'desc' } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Rehearse the whole season, then put it back.
        </p>
      </div>

      <SettingsTabs active="/admin/settings/testing" />
      <FlashMessages notice={params.notice} problem={params.problem} testIdPrefix="testing" />

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>{testMode ? 'Test mode is on' : 'Test mode is off'}</CardTitle>
          <CardDescription>
            {testMode
              ? 'Every screen, storefront included, is telling people this is a rehearsal.'
              : 'Turn it on before rehearsing. It is what unlocks the buttons below.'}
          </CardDescription>
        </div>

        <form action={setTestModeAction}>
          <input type="hidden" name="on" value={testMode ? 'false' : 'true'} />
          <Button type="submit" variant={testMode ? 'secondary' : 'primary'} data-testid="test-mode-toggle">
            {testMode ? 'Turn it off' : 'Turn it on'}
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Seed demo orders</CardTitle>
        <CardDescription>
          A dozen households with one box each, so a screen can be shown to somebody without waiting
          for real orders.
        </CardDescription>

        <form action={seedTestDataAction} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="seed-season">Season</Label>
            <Select id="seed-season" name="seasonYear" defaultValue={seasons[0]?.year ?? ''}>
              {seasons.map((season) => (
                <option key={season.id} value={season.year}>
                  {season.label}
                </option>
              ))}
            </Select>
          </div>

          <Button type="submit" disabled={!testMode} data-testid="console-seed">
            Seed
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Reset a season</CardTitle>
        <CardDescription>
          Deletes that season&apos;s orders, packages and payments. The catalog, the season and
          everybody&apos;s address book stay.
        </CardDescription>

        <form action={resetSeasonAction} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="reset-season">Season</Label>
            <Select id="reset-season" name="seasonYear" defaultValue={seasons[0]?.year ?? ''}>
              {seasons.map((season) => (
                <option key={season.id} value={season.year}>
                  {season.label}
                </option>
              ))}
            </Select>
          </div>

          <Button type="submit" variant="danger" disabled={!testMode} data-testid="console-reset">
            Reset
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Wipe everything transactional</CardTitle>
        <CardDescription>
          Every order, household, route, print batch and message in the database. Staff, permissions,
          settings and the catalog survive. There is no undo.
        </CardDescription>

        <form action={wipeTestDataAction} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="confirmation">Type WIPE</Label>
            <Input id="confirmation" name="confirmation" autoComplete="off" placeholder="WIPE" />
          </div>

          <Button type="submit" variant="danger" disabled={!testMode} data-testid="console-wipe">
            Wipe
          </Button>
        </form>
      </Card>
    </div>
  );
}
