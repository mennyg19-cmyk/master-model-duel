import Link from 'next/link';

import { bulkStageAction } from '../actions';
import { BackLink, ListSearch, Pagination } from '@/components/admin/list-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { MAX_BULK_ITEMS } from '@/lib/admin/bulk-report';
import { pageQueryString, readPageRequest } from '@/lib/admin/list-query';
import { readActiveSeason } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import { ALL_STAGES } from '@/lib/fulfillment/channel-summary';
import { listPackageBoard, readBoardFilters } from '@/lib/fulfillment/package-board';
import { stageLabel } from '@/lib/fulfillment/package-stages';
import { BOARD_PATH, FULFILLMENT_PATH, packagePath } from '@/lib/print/paths';

export const dynamic = 'force-dynamic';

const STAGE_TONES = {
  NEW: 'neutral',
  PRINTED: 'neutral',
  PACKED: 'warning',
  SENT: 'success',
  PICKED_UP: 'success',
} as const;

/**
 * The packing table's list (UR-001, G-024).
 *
 * Boxes, not orders: one row per thing that has to be filled and labelled. The
 * sweep at the bottom moves as many as are ticked and reports every one of them,
 * because on Purim night two people are working the same screen.
 */
export default async function PackageBoardPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    stage?: string;
    channel?: string;
    page?: string;
    size?: string;
    notice?: string;
    problem?: string;
  }>;
}) {
  const [params] = await Promise.all([searchParams, requirePermission('fulfillment.manage')]);
  const season = await readActiveSeason();

  if (!season) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Package board</h1>
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid="board-no-season">
          There is no season yet, so there is nothing to pack.
        </p>
      </div>
    );
  }

  const filters = readBoardFilters(params);
  const request = readPageRequest(params);

  const [{ rows, page }, methods] = await Promise.all([
    listPackageBoard(season.id, filters, request),
    db.fulfillmentMethod.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);

  const query = {
    q: filters.search,
    stage: filters.stage ?? '',
    channel: filters.methodId ?? '',
    size: String(request.pageSize),
  };

  return (
    <div className="space-y-6">
      <BackLink href={FULFILLMENT_PATH}>Fulfillment</BackLink>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Package board</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {season.label}. Search by recipient, order number or draft reference.
        </p>
      </header>

      <FlashMessages notice={params.notice} problem={params.problem} testIdPrefix="board" />

      <ListSearch
        action={BOARD_PATH}
        query={filters.search}
        placeholder="Recipient, #1024 or D-XXXX-XXXX"
        pageSize={request.pageSize}
        filters={[
          {
            name: 'stage',
            label: 'Stage',
            value: filters.stage ?? '',
            choices: [
              { value: '', label: 'Any stage' },
              ...ALL_STAGES.map((stage) => ({ value: stage, label: stageLabel(stage) })),
            ],
          },
          {
            name: 'channel',
            label: 'Channel',
            value: filters.methodId ?? '',
            choices: [
              { value: '', label: 'Any channel' },
              ...methods.map((method) => ({ value: method.id, label: method.label })),
            ],
          },
        ]}
      />

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid="board-empty">
          No box matches that.
        </p>
      ) : (
        <form action={bulkStageAction} className="space-y-4">
          <input type="hidden" name="returnTo" value={pageQueryString(query, page.page)} />

          <table className="w-full text-sm" data-testid="package-table">
            <thead className="text-left text-[var(--color-ink-muted)]">
              <tr>
                <th className="w-8 py-2" aria-label="Select" />
                <th className="py-2">Recipient</th>
                <th>Goes</th>
                <th>Order</th>
                <th className="text-right">Items</th>
                <th>Stage</th>
                <th>Paper</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((box) => (
                <tr
                  key={box.id}
                  className="border-t border-[var(--color-line)]"
                  data-testid="package-row"
                  data-package-id={box.id}
                  data-stage={box.stage}
                  data-items={box.itemCount}
                >
                  <td className="py-2">
                    <input
                      type="checkbox"
                      name="packageIds"
                      value={box.id}
                      aria-label={`Select ${box.recipientName}`}
                    />
                  </td>
                  <td className="py-2">
                    <Link
                      href={packagePath(box.id)}
                      className="text-[var(--color-brand)] underline underline-offset-4"
                    >
                      {box.recipientName}
                    </Link>
                    {box.hasGreeting ? (
                      <span className="ml-2 text-xs text-[var(--color-ink-muted)]">card</span>
                    ) : null}
                  </td>
                  <td className="text-[var(--color-ink-muted)]">
                    {box.methodLabel}
                    {box.deliveryDay ? ` — ${box.deliveryDay}` : ''}
                    <span className="block text-xs">{box.destination}</span>
                  </td>
                  <td>
                    <Link
                      href={`/admin/orders/${box.orderId}`}
                      className="underline underline-offset-4"
                    >
                      {box.orderNumber === null ? box.draftReference : `#${box.orderNumber}`}
                    </Link>
                  </td>
                  <td className="text-right">{box.itemCount}</td>
                  <td>
                    <Badge tone={STAGE_TONES[box.stage]}>{stageLabel(box.stage)}</Badge>
                  </td>
                  <td className="text-[var(--color-ink-muted)]">
                    {box.filedForPrint ? 'Filed' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div
            className="flex flex-wrap items-center gap-3 rounded-md bg-[var(--color-surface-muted)] p-3"
            data-testid="bulk-bar"
          >
            <span className="text-sm">With the selected boxes:</span>
            <Select name="stage" className="w-48" defaultValue="PACKED">
              <option value="PRINTED">Mark printed</option>
              <option value="PACKED">Mark packed</option>
              <option value="SENT">Mark sent</option>
              <option value="PICKED_UP">Mark picked up</option>
            </Select>
            <Button type="submit" variant="secondary" data-testid="bulk-apply">
              Apply to selected
            </Button>
            <span className="text-xs text-[var(--color-ink-muted)]">
              Up to {MAX_BULK_ITEMS} at a time. Every box is reported on individually.
            </span>
          </div>
        </form>
      )}

      <Pagination page={page} basePath={BOARD_PATH} query={query} />
    </div>
  );
}
