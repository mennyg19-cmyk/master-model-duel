import Link from 'next/link';

import { SettingsTabs } from '../settings-tabs';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { requirePermission } from '@/lib/auth/staff';
import { formatDateTime } from '@/lib/core/dates';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Read-only on purpose. Everything here is set by environment configuration or
 * written by a job, so a field to edit it would be a field that lies.
 */
export default async function DeveloperSettingsPage() {
  await requirePermission('settings.manage');

  const cronRuns = await db.cronRunLog.findMany({ orderBy: { startedAt: 'desc' }, take: 5 });

  const facts = [
    ['Runtime', env.NODE_ENV],
    ['App URL', env.APP_URL],
    ['Identity provider', env.AUTH_PROVIDER],
    ['Media storage', env.MEDIA_STORAGE],
    ['Trusting proxy headers', env.TRUST_PROXY_HEADERS ? 'yes' : 'no'],
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          What this deployment is running. No secrets are shown here.
        </p>
      </div>

      <SettingsTabs active="/admin/settings/developer" />

      <Card data-testid="developer-facts">
        <CardTitle>Deployment</CardTitle>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-[var(--color-line)] py-1">
              <dt className="text-[var(--color-ink-muted)]">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <CardDescription>
          <Link href="/api/health" className="underline underline-offset-4">
            Health check
          </Link>{' '}
          reports the database and environment separately.
        </CardDescription>
      </Card>

      <Card data-testid="cron-runs">
        <CardTitle>Recent scheduled runs</CardTitle>
        <CardDescription>
          Every sweep writes a row, so a job that stopped running looks different from a job with
          nothing to do.
        </CardDescription>

        {cronRuns.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Nothing has run yet.</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {cronRuns.map((run) => (
              <li key={run.id}>
                {run.jobName} · {run.status.toLowerCase()} · {formatDateTime(run.startedAt)} ·{' '}
                {run.itemsProcessed} items
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
