import {
  savePackageTypeAction,
  savePickupLocationAction,
  saveOrderSettingsAction,
  setStoreOpenAction,
} from './actions';
import { SettingsError, SettingsTabs } from './settings-tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import { readSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function OrderSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission('settings.manage');
  const [{ error }, isStoreOpen, followUpDays, packageTypes, pickupLocations] = await Promise.all([
    searchParams,
    readSetting('store.open'),
    readSetting('orders.followUpDays'),
    db.packageType.findMany({ orderBy: { name: 'asc' } }),
    db.pickupLocation.findMany({ orderBy: { name: 'asc' } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Everything the office changes without a deploy.
        </p>
      </div>

      <SettingsTabs active="/admin/settings" />
      <SettingsError message={error} />

      <Card>
        <CardTitle>Store status</CardTitle>
        <CardDescription>
          Closed hides ordering on the storefront and blocks the order routes. Browsing stays open.
        </CardDescription>

        <div className="mt-4 flex items-center gap-4">
          <Badge tone={isStoreOpen ? 'success' : 'warning'}>{isStoreOpen ? 'Open' : 'Closed'}</Badge>
          <form action={setStoreOpenAction}>
            <input type="hidden" name="open" value={isStoreOpen ? 'false' : 'true'} />
            <Button type="submit" variant="secondary">
              {isStoreOpen ? 'Close the store' : 'Open the store'}
            </Button>
          </form>
        </div>
      </Card>

      <Card>
        <CardTitle>Follow-up</CardTitle>
        <CardDescription>
          How many days after an order the follow-up email goes out. The email itself ships with the
          notification platform; this is the number it will read.
        </CardDescription>

        <form action={saveOrderSettingsAction} className="mt-4 flex items-end gap-3">
          <div>
            <Label htmlFor="followUpDays">Days</Label>
            <Input
              id="followUpDays"
              name="followUpDays"
              type="number"
              min={0}
              max={90}
              defaultValue={followUpDays}
              className="w-24"
            />
          </div>
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </form>
      </Card>

      <Card data-testid="package-types">
        <CardTitle>Box sizes ({packageTypes.length})</CardTitle>
        <CardDescription>
          The boxes the office stocks. Rate shopping needs real dimensions, so every field is
          required.
        </CardDescription>

        <ul className="mt-3 space-y-1 text-sm">
          {packageTypes.map((packageType) => (
            <li key={packageType.id}>
              {packageType.name} — {packageType.lengthMm}×{packageType.widthMm}×{packageType.heightMm}{' '}
              mm, up to {packageType.maxWeightGrams} g
            </li>
          ))}
        </ul>

        <form action={savePackageTypeAction} className="mt-4 grid gap-3 sm:grid-cols-6 sm:items-end">
          <div className="sm:col-span-2">
            <Label htmlFor="packageType-name">Name</Label>
            <Input id="packageType-name" name="name" required />
          </div>
          {(
            [
              ['lengthMm', 'Length (mm)'],
              ['widthMm', 'Width (mm)'],
              ['heightMm', 'Height (mm)'],
              ['maxWeightGrams', 'Max weight (g)'],
            ] as const
          ).map(([field, label]) => (
            <div key={field}>
              <Label htmlFor={`packageType-${field}`}>{label}</Label>
              <Input id={`packageType-${field}`} name={field} type="number" min={1} required />
            </div>
          ))}
          <Button type="submit" variant="secondary" className="sm:col-span-2">
            Add box size
          </Button>
        </form>
      </Card>

      <Card data-testid="pickup-locations">
        <CardTitle>Pickup locations ({pickupLocations.length})</CardTitle>
        <CardDescription>Where a customer can collect packages instead of having them delivered.</CardDescription>

        <ul className="mt-3 space-y-1 text-sm">
          {pickupLocations.map((location) => (
            <li key={location.id}>
              {location.name} — {location.line1}, {location.city} {location.state}{' '}
              {location.postalCode}
            </li>
          ))}
        </ul>

        <form action={savePickupLocationAction} className="mt-4 grid gap-3 sm:grid-cols-6 sm:items-end">
          <div className="sm:col-span-2">
            <Label htmlFor="pickup-name">Name</Label>
            <Input id="pickup-name" name="name" required />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="pickup-line1">Street</Label>
            <Input id="pickup-line1" name="line1" required />
          </div>
          <div>
            <Label htmlFor="pickup-city">City</Label>
            <Input id="pickup-city" name="city" required />
          </div>
          <div>
            <Label htmlFor="pickup-state">State</Label>
            <Input id="pickup-state" name="state" maxLength={2} required />
          </div>
          <div>
            <Label htmlFor="pickup-postalCode">ZIP</Label>
            <Input id="pickup-postalCode" name="postalCode" required />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="pickup-instructions">Instructions</Label>
            <Input id="pickup-instructions" name="instructions" />
          </div>
          <Button type="submit" variant="secondary" className="sm:col-span-2">
            Add location
          </Button>
        </form>
      </Card>
    </div>
  );
}
