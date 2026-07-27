import Link from 'next/link';

import { resolveCleanupFlagAction, scanAddressBookAction } from '../actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { formatDateTime } from '@/lib/core/dates';
import { readCleanupFlags } from '@/lib/migration/address-cleanup';

export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  UNUSABLE_ADDRESS: 'Cannot be delivered to',
  DUPLICATE_ADDRESS: 'Written twice',
  DUPLICATE_CUSTOMER: 'Same household twice',
};

/**
 * The queue the migration leaves behind (UR-014).
 *
 * Every row is a question, and the two answers are "merge them" and "leave it".
 * Leaving it is a real answer and it sticks: a rescan does not ask again about
 * an address somebody has already decided is the best the office has.
 */
export default async function AddressCleanupPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; problem?: string; show?: string }>;
}) {
  const [params] = await Promise.all([searchParams, requirePermission('migration.manage')]);

  const showAll = params.show === 'all';
  const flags = await readCleanupFlags(showAll ? 'ALL' : 'OPEN');

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Address book cleanup</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Broken addresses, the same door written twice, and one family under two logins.
        </p>
      </header>

      <FlashMessages notice={params.notice} problem={params.problem} testIdPrefix="cleanup" />

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>{flags.length === 0 ? 'Nothing waiting' : `${flags.length} listed`}</CardTitle>
          <CardDescription>
            A scan reads every address on file. It changes nothing on its own.
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={showAll ? '/admin/migration/cleanup' : '/admin/migration/cleanup?show=all'}
            className="text-sm underline underline-offset-4"
          >
            {showAll ? 'Show open only' : 'Show decided too'}
          </Link>

          <form action={scanAddressBookAction}>
            <Button type="submit" data-testid="cleanup-scan">
              Scan now
            </Button>
          </form>
        </div>
      </Card>

      {flags.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]">The address book is clean.</p>
      ) : (
        <table className="w-full text-sm" data-testid="cleanup-flags">
          <thead className="text-left text-[var(--color-ink-muted)]">
            <tr>
              <th className="py-2">What</th>
              <th>Detail</th>
              <th>Customer</th>
              <th>Found</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => (
              <tr key={flag.id} className="border-t border-[var(--color-line)]">
                <td className="py-2">{KIND_LABELS[flag.kind] ?? flag.kind}</td>
                <td className="text-[var(--color-ink-muted)]">{flag.note}</td>
                <td>
                  <Link
                    href={`/admin/customers/${flag.customerId}`}
                    className="underline underline-offset-4"
                  >
                    Open
                  </Link>
                </td>
                <td className="text-[var(--color-ink-muted)]">{formatDateTime(flag.createdAt)}</td>
                <td>
                  {flag.status === 'OPEN' ? (
                    <div className="flex gap-2">
                      {flag.kind === 'UNUSABLE_ADDRESS' ? null : (
                        <form action={resolveCleanupFlagAction}>
                          <input type="hidden" name="flagId" value={flag.id} />
                          <input type="hidden" name="decision" value="MERGED" />
                          <Button type="submit" variant="secondary" data-testid="cleanup-merge">
                            Merge
                          </Button>
                        </form>
                      )}

                      <form action={resolveCleanupFlagAction}>
                        <input type="hidden" name="flagId" value={flag.id} />
                        <input type="hidden" name="decision" value="KEPT" />
                        <Button type="submit" variant="ghost" data-testid="cleanup-keep">
                          Keep
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <Badge tone="success">{flag.status}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
