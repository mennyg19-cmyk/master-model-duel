import Link from 'next/link';
import { notFound } from 'next/navigation';

import { advanceStageAction, editPackageAction } from '../../actions';
import { BackLink } from '@/components/admin/list-controls';
import { CarriageCard } from '@/components/admin/carriage-card';
import { OrderPrintLinks } from '@/components/admin/order-print-links';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { readActiveSeason } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';
import { formatCents } from '@/lib/core/money';
import { formatDateTime } from '@/lib/core/dates';
import { db } from '@/lib/db';
import { readPackageDetail, type PackageDetail } from '@/lib/fulfillment/package-board';
import { readCarriageCard } from '@/lib/shipping/carriage-view';
import { ALL_STAGES } from '@/lib/fulfillment/channel-summary';
import { checkPackageStage, stageLabel } from '@/lib/fulfillment/package-stages';
import { batchPath, BOARD_PATH, packagePath } from '@/lib/print/paths';

export const dynamic = 'force-dynamic';

/**
 * One box (UR-001, G-003, G-004).
 *
 * Three things happen here and they are deliberately three separate forms: move
 * this box along, take items out of it into a new box, or put items into another
 * box on the same order. Each posts the version it was drawn with, so the second
 * person to press a button on a stale screen is told rather than obeyed.
 */
export default async function PackageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ packageId: string }>;
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  const [{ packageId }, flash] = await Promise.all([
    params,
    searchParams,
    requirePermission('fulfillment.manage'),
  ]);

  const season = await readActiveSeason();
  const box = season ? await readPackageDetail(season.id, packageId) : null;
  if (!box) notFound();

  // Only a shipping box has carriage; a delivery run and a pickup counter have
  // no carrier, no label and nothing to track.
  const carriage =
    box.methodKind === 'SHIPPING' && season ? await readCarriageCard(db, season.id, packageId) : null;

  const settled = box.stage === 'SENT' || box.stage === 'PICKED_UP';
  const nextStages = ALL_STAGES.filter(
    (stage) => checkPackageStage(box.stage, stage, box.methodKind).ok,
  );

  return (
    <div className="space-y-6">
      <BackLink href={BOARD_PATH}>Package board</BackLink>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="package-recipient">
            {box.recipientName}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {box.methodLabel}
            {box.deliveryDay ? ` — ${box.deliveryDay}` : ''} · {box.destination}
          </p>
        </div>
        <div
          className="text-right text-sm"
          data-testid="package-stage"
          data-stage={box.stage}
          data-version={box.version}
        >
          <Badge tone={settled ? 'success' : 'neutral'}>{stageLabel(box.stage)}</Badge>
          <p className="mt-1 text-[var(--color-ink-muted)]">
            <Link href={`/admin/orders/${box.orderId}`} className="underline underline-offset-4">
              {box.orderNumber === null ? box.draftReference : `Order #${box.orderNumber}`}
            </Link>{' '}
            · {box.customerName}
          </p>
        </div>
      </header>

      <FlashMessages notice={flash.notice} problem={flash.problem} testIdPrefix="package" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Move this box along</CardTitle>
          <CardDescription>
            Printing paper never does this. Somebody has to say the box is packed, and somebody has
            to say it left.
          </CardDescription>

          {nextStages.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]" data-testid="stage-done">
              This box is {stageLabel(box.stage).toLowerCase()}. There is nowhere further to move
              it.
            </p>
          ) : (
            <form action={advanceStageAction} className="mt-3 flex flex-wrap items-center gap-3">
              <input type="hidden" name="packageId" value={box.id} />
              <input type="hidden" name="version" value={box.version} />
              <Select name="stage" className="w-44" defaultValue={nextStages[0]}>
                {nextStages.map((stage) => (
                  <option key={stage} value={stage}>
                    {stageLabel(stage)}
                  </option>
                ))}
              </Select>
              <Button type="submit" data-testid="advance-stage">
                Mark it
              </Button>
            </form>
          )}

          <dl className="mt-4 space-y-1 text-sm text-[var(--color-ink-muted)]">
            <Stamp label="Printed" at={box.printedAt} />
            <Stamp label="Packed" at={box.packedAt} />
            <Stamp label="Sent" at={box.sentAt} />
            <Stamp label="Picked up" at={box.pickedUpAt} />
          </dl>
        </Card>

        <Card>
          <CardTitle>Paper</CardTitle>
          <CardDescription>
            The whole order&rsquo;s slips, labels and cards. Reading them changes nothing.
          </CardDescription>
          <div className="mt-3">
            <OrderPrintLinks orderId={box.orderId} />
          </div>

          <p className="mt-4 text-sm font-medium">Filed on</p>
          {box.filings.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-muted)]" data-testid="package-unfiled">
              Not on a print batch yet.
            </p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm" data-testid="package-filings">
              {box.filings.map((filing) => (
                <li key={`${filing.batchId}-${filing.groupId}`}>
                  <Link href={batchPath(filing.batchId)} className="underline underline-offset-4">
                    {filing.batchLabel}
                  </Link>{' '}
                  <span className="text-[var(--color-ink-muted)]">· {filing.groupLabel}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
            Fulfillment charged on this box: {formatCents(box.fulfillmentFeeCents)}
          </p>
        </Card>
      </div>

      {carriage ? <CarriageCard carriage={carriage} /> : null}

      {box.greetingMessage ? (
        <Card data-testid="package-greeting">
          <CardTitle>Card message</CardTitle>
          <p className="mt-2 whitespace-pre-line text-sm">{box.greetingMessage}</p>
        </Card>
      ) : null}

      <PackageContents box={box} settled={settled} />
    </div>
  );
}

/**
 * The items and the two ways to move them out.
 *
 * One form with two submit buttons rather than two forms: staff tick the items
 * once and then decide whether those items become their own box or join another
 * one. Two forms would mean two sets of checkboxes over the same list.
 */
function PackageContents({ box, settled }: { box: PackageDetail; settled: boolean }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">
        What is in it ({box.lines.length} line{box.lines.length === 1 ? '' : 's'})
      </h2>

      {settled ? (
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid="package-locked">
          This box has already {box.stage === 'SENT' ? 'gone out' : 'been collected'}, so what is in
          it can no longer change.
        </p>
      ) : null}

      <form action={editPackageAction} className="space-y-3" data-testid="package-edit">
        <input type="hidden" name="packageId" value={box.id} />
        <input type="hidden" name="version" value={box.version} />

        <table className="w-full text-sm" data-testid="package-lines">
          <thead className="text-left text-[var(--color-ink-muted)]">
            <tr>
              {settled ? null : <th className="w-8 py-2" aria-label="Select" />}
              <th className="py-2">Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {box.lines.map((line) => (
              <tr
                key={line.id}
                className="border-t border-[var(--color-line)]"
                data-testid="package-line"
                data-line-id={line.id}
              >
                {settled ? null : (
                  <td className="py-2">
                    <input
                      type="checkbox"
                      name="lineIds"
                      value={line.id}
                      aria-label={`Select ${line.description}`}
                    />
                  </td>
                )}
                <td className="py-2">{line.description}</td>
                <td className="text-right">{line.quantity}</td>
                <td className="text-right">{formatCents(line.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {settled ? null : (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-[var(--color-surface-muted)] p-3">
            <Button
              type="submit"
              name="intent"
              value="split"
              variant="secondary"
              data-testid="split-package"
            >
              Split the ticked items into their own box
            </Button>

            {box.siblings.length === 0 ? (
              <span className="text-xs text-[var(--color-ink-muted)]" data-testid="no-siblings">
                This order has no other box to move items into.
              </span>
            ) : (
              <>
                <Select name="toPackageId" className="w-64">
                  {box.siblings.map((sibling) => (
                    <option key={sibling.id} value={sibling.id}>
                      {sibling.recipientName} — {sibling.methodLabel} ({stageLabel(sibling.stage)})
                    </option>
                  ))}
                </Select>
                <Button
                  type="submit"
                  name="intent"
                  value="move"
                  variant="secondary"
                  data-testid="regroup-package"
                >
                  Move ticked items there
                </Button>
              </>
            )}
          </div>
        )}
      </form>

      {box.siblings.length > 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]">
          Other boxes on this order:{' '}
          {box.siblings.map((sibling, index) => (
            <span key={sibling.id}>
              {index > 0 ? ', ' : ''}
              <Link href={packagePath(sibling.id)} className="underline underline-offset-4">
                {sibling.recipientName}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}

function Stamp({ label, at }: { label: string; at: Date | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{label}</dt>
      <dd>{at ? formatDateTime(at) : '—'}</dd>
    </div>
  );
}
