import Link from 'next/link';

import { saveEmailBrandingAction, saveEmailSettingsAction, sendTestEmailAction } from './actions';
import { SettingsTabs } from '../settings-tabs';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import { readEmailBranding, senderLine } from '@/lib/email/branding';
import { isEmailCaptured } from '@/lib/email/provider';
import { readSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string; notice?: string }>;
}) {
  await requirePermission('settings.manage');
  const [flash, branding, retentionDays, subscribers, unsubscribed] = await Promise.all([
    searchParams,
    readEmailBranding(),
    readSetting('email.logRetentionDays'),
    db.newsletterSubscriber.count({ where: { status: 'SUBSCRIBED' } }),
    db.newsletterSubscriber.count({ where: { status: 'UNSUBSCRIBED' } }),
  ]);

  const sender = senderLine(branding);
  const captured = isEmailCaptured();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Who email comes from, what it looks like, and how long it is kept.
        </p>
      </div>

      <SettingsTabs active="/admin/settings/email" />
      <FlashMessages notice={flash.notice} problem={flash.problem} testIdPrefix="email-settings" />

      <Card>
        <CardTitle>Sender</CardTitle>
        <CardDescription>
          Used by every transactional email and by campaigns. Until an address is set here the
          sweeper holds email in the outbox rather than sending it from nobody.
        </CardDescription>

        <form action={saveEmailSettingsAction} className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="fromName">From name</Label>
            <Input id="fromName" name="fromName" defaultValue={branding.fromName} />
          </div>
          <div>
            <Label htmlFor="fromAddress">From address</Label>
            <Input
              id="fromAddress"
              name="fromAddress"
              type="email"
              defaultValue={branding.fromAddress}
            />
          </div>
          <div>
            <Label htmlFor="replyToAddress">Reply-to</Label>
            <Input
              id="replyToAddress"
              name="replyToAddress"
              type="email"
              defaultValue={branding.replyToAddress}
            />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" variant="secondary">
              Save sender
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardTitle>Letterhead</CardTitle>
        <CardDescription>
          Wrapped around every email the app sends, campaigns included.
        </CardDescription>

        <form action={saveEmailBrandingAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="logoUrl">Logo address</Label>
            <Input
              id="logoUrl"
              name="logoUrl"
              defaultValue={branding.logoUrl}
              placeholder="https://…/logo.png"
            />
          </div>
          <div>
            <Label htmlFor="accentColor">Accent colour</Label>
            <Input id="accentColor" name="accentColor" defaultValue={branding.accentColor} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="footerText">Footer line</Label>
            <Input
              id="footerText"
              name="footerText"
              defaultValue={branding.footerText}
              placeholder="Tomchei Shabbos · 555-0100 · office@example.org"
            />
          </div>
          <div>
            <Label htmlFor="logRetentionDays">Keep delivered email for (days)</Label>
            <Input
              id="logRetentionDays"
              name="logRetentionDays"
              inputMode="numeric"
              defaultValue={String(retentionDays)}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              Save letterhead
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardTitle>Send a test</CardTitle>
        <CardDescription>
          {captured
            ? 'Email is set to capture, so a test is filed as a captured message instead of leaving the machine. Either way it goes straight out rather than through the outbox — nothing is queued.'
            : sender
              ? `A single email from ${sender}, straight out, bypassing the queue.`
              : 'Set a from address above first — there is nothing to send from yet.'}
        </CardDescription>

        <form action={sendTestEmailAction} className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-64">
            <Label htmlFor="destination">Address</Label>
            <Input id="destination" name="destination" type="email" required />
          </div>
          <Button type="submit" variant="secondary" data-testid="send-test-email">
            Send test
          </Button>
        </form>
      </Card>

      <Card data-testid="newsletter-counts">
        <CardTitle>Newsletter list</CardTitle>
        <CardDescription>
          {subscribers} subscribed · {unsubscribed} unsubscribed. Unsubscribed rows are kept so a
          later import cannot add someone back. Campaigns and lists live on the{' '}
          <Link href="/admin/email" className="underline underline-offset-4">
            email page
          </Link>
          .
        </CardDescription>
      </Card>
    </div>
  );
}
