import Link from 'next/link';

import { saveCampaignAction } from './actions';
import { CampaignAudienceFields } from './audience-fields';
import { CampaignStatusBadge } from './campaign-status';
import { EmailTabs } from './email-tabs';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { formatDate } from '@/lib/core/dates';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The email hub (R-082, R-083).
 *
 * One screen for every letter the organisation has written, and the form that
 * starts the next one. A campaign is drafted here and sent from its own page,
 * because sending is the one button on this hub that reaches four thousand
 * people and it should not sit next to Save.
 */
export default async function EmailHubPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  await requirePermission('email.manage');

  const [flash, campaigns, lists, subscribers] = await Promise.all([
    searchParams,
    db.emailCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { list: { select: { name: true } }, _count: { select: { sends: true } } },
    }),
    db.subscriberList.findMany({ orderBy: { name: 'asc' } }),
    db.newsletterSubscriber.count({ where: { status: 'SUBSCRIBED' } }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Email</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Campaigns, subscriber lists and the emails the app sends on its own.
        </p>
      </header>

      <EmailTabs active="/admin/email" />
      <FlashMessages notice={flash.notice} problem={flash.problem} testIdPrefix="email" />

      <Card>
        <CardTitle>New campaign</CardTitle>
        <CardDescription>
          {subscribers} address{subscribers === 1 ? '' : 'es'} are subscribed. A campaign is saved as
          a draft; nothing goes out until you open it and press Send.
        </CardDescription>

        <form action={saveCampaignAction} className="mt-4 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required placeholder="Purim 2027 opening" />
            </div>
            <div>
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" name="subject" required placeholder="Ordering is open" />
            </div>
          </div>

          <CampaignAudienceFields lists={lists} />

          <div>
            <Label htmlFor="body">Message</Label>
            <Textarea
              id="body"
              name="body"
              required
              rows={6}
              placeholder="Write in plain text. Links become links in the email."
            />
          </div>

          <div>
            <Button type="submit">Save draft</Button>
          </div>
        </form>
      </Card>

      <table className="w-full text-left text-sm" data-testid="campaigns-table">
        <thead className="border-b border-[var(--color-line)] text-[var(--color-ink-muted)]">
          <tr>
            <th className="py-2">Campaign</th>
            <th className="py-2">Audience</th>
            <th className="py-2">Status</th>
            <th className="py-2">Written to</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr
              key={campaign.id}
              className="border-b border-[var(--color-line)] align-top"
              data-testid="campaign-row"
              data-status={campaign.status}
            >
              <td className="py-3">
                <Link
                  href={`/admin/email/campaigns/${campaign.id}`}
                  className="underline underline-offset-4"
                >
                  {campaign.name}
                </Link>
                <span className="block text-xs text-[var(--color-ink-muted)]">
                  {campaign.subject}
                </span>
              </td>
              <td className="py-3">{campaign.list?.name ?? 'Everyone subscribed'}</td>
              <td className="py-3">
                <CampaignStatusBadge status={campaign.status} />
                {campaign.sentAt ? (
                  <span className="block text-xs text-[var(--color-ink-muted)]">
                    {formatDate(campaign.sentAt)}
                  </span>
                ) : null}
              </td>
              <td className="py-3" data-testid="campaign-recipients">
                {campaign._count.sends}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {campaigns.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]">No campaigns have been written yet.</p>
      ) : null}
    </div>
  );
}
