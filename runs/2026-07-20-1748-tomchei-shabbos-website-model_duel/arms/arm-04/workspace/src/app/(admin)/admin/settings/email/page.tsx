import { saveEmailSettingsAction } from '../actions';
import { SettingsError, SettingsTabs } from '../settings-tabs';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import { readSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission('settings.manage');
  const [{ error }, fromName, fromAddress, replyToAddress, subscribers, unsubscribed] =
    await Promise.all([
      searchParams,
      readSetting('email.fromName'),
      readSetting('email.fromAddress'),
      readSetting('email.replyToAddress'),
      db.newsletterSubscriber.count({ where: { status: 'SUBSCRIBED' } }),
      db.newsletterSubscriber.count({ where: { status: 'UNSUBSCRIBED' } }),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Who email comes from, and who is on the newsletter list.
        </p>
      </div>

      <SettingsTabs active="/admin/settings/email" />
      <SettingsError message={error} />

      <Card>
        <CardTitle>Sender</CardTitle>
        <CardDescription>
          Used by every transactional email and by the newsletter. Templates and sending live in the
          notification phase; this is the identity they will use.
        </CardDescription>

        <form action={saveEmailSettingsAction} className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="fromName">From name</Label>
            <Input id="fromName" name="fromName" defaultValue={fromName} />
          </div>
          <div>
            <Label htmlFor="fromAddress">From address</Label>
            <Input id="fromAddress" name="fromAddress" type="email" defaultValue={fromAddress} />
          </div>
          <div>
            <Label htmlFor="replyToAddress">Reply-to</Label>
            <Input
              id="replyToAddress"
              name="replyToAddress"
              type="email"
              defaultValue={replyToAddress}
            />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" variant="secondary">
              Save sender
            </Button>
          </div>
        </form>
      </Card>

      <Card data-testid="newsletter-counts">
        <CardTitle>Newsletter list</CardTitle>
        <CardDescription>
          {subscribers} subscribed · {unsubscribed} unsubscribed. Unsubscribed rows are kept so a
          later import cannot add someone back.
        </CardDescription>
      </Card>
    </div>
  );
}
