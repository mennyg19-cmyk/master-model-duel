import Link from 'next/link';
import { notFound } from 'next/navigation';

import { reprintGroupAction } from '../../actions';
import { BackLink } from '@/components/admin/list-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FlashMessages } from '@/components/ui/flash';
import { readActiveSeason } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';
import { formatDateTime } from '@/lib/core/dates';
import { ARTIFACT_LABELS, PRINT_ARTIFACTS } from '@/lib/print/documents';
import { FULFILLMENT_PATH, groupArtifactPath } from '@/lib/print/paths';
import { readBatch } from '@/lib/print/print-batch-service';

export const dynamic = 'force-dynamic';

/**
 * One print batch (UR-005).
 *
 * The batch is a filing plan, not a document: it says which boxes are in which
 * group, and each group serves its three PDFs from that. Reprinting a group
 * makes a new batch pointing back here rather than changing what this one says,
 * so the pile already on the table still matches a record.
 */
export default async function PrintBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  const [{ batchId }, flash] = await Promise.all([
    params,
    searchParams,
    requirePermission('fulfillment.manage'),
  ]);

  const season = await readActiveSeason();
  const batch = season ? await readBatch(season.id, batchId) : null;
  if (!batch) notFound();

  return (
    <div className="space-y-6">
      <BackLink href={FULFILLMENT_PATH}>Fulfillment</BackLink>

      <header className="space-y-1">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {batch.label}
          <Badge tone={batch.kind === 'NIGHTLY' ? 'neutral' : 'warning'}>{batch.kind}</Badge>
        </h1>
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid="batch-summary" data-packages={batch.packageCount} data-groups={batch.groups.length}>
          {batch.packageCount} box{batch.packageCount === 1 ? '' : 'es'} in {batch.groups.length}{' '}
          group{batch.groups.length === 1 ? '' : 's'} · {formatDateTime(batch.createdAt)}
          {batch.createdBy ? ` · ${batch.createdBy}` : ''}
        </p>
      </header>

      <FlashMessages notice={flash.notice} problem={flash.problem} testIdPrefix="batch" />

      <p className="text-sm text-[var(--color-ink-muted)]">
        Printing any of these leaves every box exactly where it is. Marking boxes printed, packed
        or sent is a separate decision on the board.
      </p>

      <ul className="space-y-3" data-testid="group-list">
        {batch.groups.map((group) => (
          <li
            key={group.id}
            className="space-y-2 rounded-md border border-[var(--color-line)] p-3"
            data-testid="group-row"
            data-group-id={group.id}
            data-packages={group.packageCount}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-medium">{group.label}</span>
              <span className="text-sm text-[var(--color-ink-muted)]">
                {group.packageCount} box{group.packageCount === 1 ? '' : 'es'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm">
              {PRINT_ARTIFACTS.map((artifact) => (
                <Link
                  key={artifact}
                  href={groupArtifactPath(batch.id, group.id, artifact)}
                  className="text-[var(--color-brand)] underline underline-offset-4"
                  data-testid={`print-${artifact}`}
                >
                  {ARTIFACT_LABELS[artifact]}
                </Link>
              ))}

              <form action={reprintGroupAction}>
                <input type="hidden" name="batchId" value={batch.id} />
                <input type="hidden" name="groupId" value={group.id} />
                <Button type="submit" variant="secondary" data-testid="reprint-group">
                  Reprint this group
                </Button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
