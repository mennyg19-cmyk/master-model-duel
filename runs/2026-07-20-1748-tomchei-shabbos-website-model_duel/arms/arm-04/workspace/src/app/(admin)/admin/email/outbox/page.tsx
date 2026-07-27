import { EmailTabs } from '../email-tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { requirePermission } from '@/lib/auth/staff';
import { formatDateTime } from '@/lib/core/dates';
import { db } from '@/lib/db';
import { MAX_DELIVERY_ATTEMPTS } from '@/lib/notifications/dispatch';

export const dynamic = 'force-dynamic';

const STATUS_TONE = { QUEUED: 'neutral', SENT: 'success', FAILED: 'danger' } as const;

/**
 * Every message the app has tried to send, and what happened (R-085).
 *
 * "Did she get the email?" is answered here rather than by reading a log file
 * on the server: the row carries the attempt count, the last error the provider
 * gave, and when the next try is due.
 */
export default async function OutboxPage() {
  await requirePermission('email.manage');

  const [messages, waiting, failed] = await Promise.all([
    db.notificationLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    db.notificationLog.count({ where: { status: 'QUEUED' } }),
    db.notificationLog.count({ where: { status: 'FAILED' } }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Outbox</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {waiting} waiting to go out, {failed} given up on after {MAX_DELIVERY_ATTEMPTS} tries.
        </p>
      </header>

      <EmailTabs active="/admin/email/outbox" />

      <Card>
        <CardTitle>Last 100 messages</CardTitle>
        <CardDescription>
          Messages are queued by the app and sent by a cron sweep, so a provider being down delays
          an email rather than losing it.
        </CardDescription>

        <table className="mt-4 w-full text-left text-sm" data-testid="outbox-table">
          <thead className="border-b border-[var(--color-line)] text-[var(--color-ink-muted)]">
            <tr>
              <th className="py-2">To</th>
              <th className="py-2">Kind</th>
              <th className="py-2">Status</th>
              <th className="py-2">Tries</th>
              <th className="py-2">Last word from the provider</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr
                key={message.id}
                className="border-b border-[var(--color-line)] align-top"
                data-testid="outbox-row"
                data-status={message.status}
              >
                <td className="py-2">
                  {message.destination}
                  <span className="block text-xs text-[var(--color-ink-muted)]">
                    {message.subject ?? `${message.channel.toLowerCase()} message`}
                  </span>
                </td>
                <td className="py-2">{message.kind}</td>
                <td className="py-2">
                  <Badge tone={STATUS_TONE[message.status]}>{message.status.toLowerCase()}</Badge>
                  <span className="block text-xs text-[var(--color-ink-muted)]">
                    {formatDateTime(message.sentAt ?? message.failedAt ?? message.createdAt)}
                  </span>
                </td>
                <td className="py-2" data-testid="outbox-attempts">
                  {message.attempts}
                  {message.nextAttemptAt && message.status === 'QUEUED' ? (
                    <span className="block text-xs text-[var(--color-ink-muted)]">
                      next {formatDateTime(message.nextAttemptAt)}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 text-xs text-[var(--color-ink-muted)]">
                  {message.lastError ?? message.providerReference ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {messages.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-ink-muted)]">Nothing has been sent yet.</p>
        ) : null}
      </Card>
    </div>
  );
}
