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
  const [{ error }, baseRateCents, thresholdCents, deliveryZips, deliveryDays, origin] =
    await Promise.all([
      searchParams,
      readSetting('shipping.baseRateCents'),
      readSetting('shipping.freeShippingThresholdCents'),
      readSetting('shipping.deliveryZips'),
      readSetting('delivery.dayChoices'),
      readSetting('shipping.origin'),
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
            Checkout quotes the carriers and charges what they say. These two are the fallback: the
            base rate prices a box when no carrier answers, and the free-shipping total is the
            organization&rsquo;s own promise, which beats any carrier price.
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

        <Card data-testid="shipping-origin">
          <CardTitle>Where carriers collect from</CardTitle>
          <CardDescription>
            The ship-from address every rate is quoted against and every label is printed with.
            Leave it empty and no carrier can be asked, so shipping falls back to the base rate
            above.
          </CardDescription>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="originName">Name on the label</Label>
              <Input id="originName" name="originName" defaultValue={origin.name} />
            </div>
            <div>
              <Label htmlFor="originLine1">Street</Label>
              <Input id="originLine1" name="originLine1" defaultValue={origin.line1} />
            </div>
            <div>
              <Label htmlFor="originLine2">Unit (optional)</Label>
              <Input id="originLine2" name="originLine2" defaultValue={origin.line2} />
            </div>
            <div>
              <Label htmlFor="originCity">City</Label>
              <Input id="originCity" name="originCity" defaultValue={origin.city} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="originState">State</Label>
                <Input id="originState" name="originState" defaultValue={origin.state} />
              </div>
              <div>
                <Label htmlFor="originPostalCode">ZIP</Label>
                <Input
                  id="originPostalCode"
                  name="originPostalCode"
                  defaultValue={origin.postalCode}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="originPhone">Phone the carrier can call</Label>
              <Input id="originPhone" name="originPhone" defaultValue={origin.phone} />
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
