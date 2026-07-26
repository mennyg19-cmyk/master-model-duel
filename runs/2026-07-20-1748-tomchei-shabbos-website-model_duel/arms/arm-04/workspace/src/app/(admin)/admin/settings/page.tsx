import { setStoreOpenAction } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { requirePermission } from '@/lib/auth/staff';
import { readSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await requirePermission('settings.manage');
  const isStoreOpen = await readSetting('store.open');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Store-wide switches. Catalog, shipping and email settings arrive with those phases.
        </p>
      </div>

      <Card>
        <CardTitle>Store status</CardTitle>
        <CardDescription>
          Closed hides ordering on the storefront. Browsing stays available.
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
    </div>
  );
}
