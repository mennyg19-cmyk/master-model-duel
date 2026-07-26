import { saveShippingSettingsAction } from '../actions';
import { SettingsError, SettingsTabs } from '../settings-tabs';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { requirePermission } from '@/lib/auth/staff';
import { readSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function ShippingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission('settings.manage');
  const [{ error }, baseRateCents, thresholdCents, deliveryZips, deliveryDays] = await Promise.all([
    searchParams,
    readSetting('shipping.baseRateCents'),
    readSetting('shipping.freeShippingThresholdCents'),
    readSetting('shipping.deliveryZips'),
    readSetting('delivery.dayChoices'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Shipping rates, the rules that waive them, and where volunteers drive.
        </p>
      </div>

      <SettingsTabs active="/admin/settings/shipping" />
      <SettingsError message={error} />

      <form action={saveShippingSettingsAction} className="space-y-6">
        <Card>
          <CardTitle>Rates and rules</CardTitle>
          <CardDescription>
            The starting rate carriers are compared against, and the order total that ships free.
            Live carrier rates arrive with the shipping phase; these are what checkout reads until
            then.
          </CardDescription>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="baseRate">Base shipping rate (dollars)</Label>
              <Input id="baseRate" name="baseRate" defaultValue={(baseRateCents / 100).toFixed(2)} />
            </div>
            <div>
              <Label htmlFor="freeShippingThreshold">Free over (dollars, 0 = never)</Label>
              <Input
                id="freeShippingThreshold"
                name="freeShippingThreshold"
                defaultValue={(thresholdCents / 100).toFixed(2)}
              />
            </div>
          </div>
        </Card>

        <Card data-testid="delivery-zips">
          <CardTitle>Volunteer delivery ZIP codes ({deliveryZips.length})</CardTitle>
          <CardDescription>
            Volunteer delivery is offered only for these ZIP codes, with no override — everywhere
            else ships. One per line or separated by commas. An empty list turns delivery off
            entirely.
          </CardDescription>

          <textarea
            id="deliveryZips"
            name="deliveryZips"
            rows={6}
            defaultValue={deliveryZips.join('\n')}
            className="mt-3 w-full max-w-sm rounded-md border border-[var(--color-line)] bg-white px-3 py-2 font-mono text-sm"
          />
        </Card>

        <Card data-testid="delivery-days">
          <CardTitle>Volunteer delivery days ({deliveryDays.length})</CardTitle>
          <CardDescription>
            The days drivers are out in Purim week, one per line, written the way you say them to
            them. Customers pick one of these for each delivery at checkout. An empty list means no
            day is asked for.
          </CardDescription>

          <textarea
            id="deliveryDays"
            name="deliveryDays"
            rows={4}
            defaultValue={deliveryDays.join('\n')}
            className="mt-3 w-full max-w-sm rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
          />
        </Card>

        <Button type="submit">Save shipping settings</Button>
      </form>
    </div>
  );
}
