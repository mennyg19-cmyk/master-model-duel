import Link from 'next/link';

import { notifyPickupReadyAction, stampPickedUpAction, sweepPickupReadyAction } from './actions';
import { NoSeason } from '@/components/admin/no-season';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FlashMessages } from '@/components/ui/flash';
import { readActiveSeason } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';
import { formatDate } from '@/lib/core/dates';
import { listPickupCounter, listUnclaimedPickups } from '@/lib/pickup/pickup-service';
import { pickupDoorListPath } from '@/lib/routing/paths';

export const dynamic = 'force-dynamic';

/**
 * The pickup counter (UR-010, G-017, G-026).
 *
 * A box is only ready when volunteers have packed it and its items are still on
 * hand, so the ready button stays disabled until both are true and the row says
 * which one is not. Underneath is the unclaimed list, which is a phone list.
 */
export default async function PickupPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  const [params] = await Promise.all([searchParams, requirePermission('fulfillment.manage')]);
  const season = await readActiveSeason();

  if (!season) {
    return (
      <NoSeason
        title="Pickup"
        message="There is no season, so the counter is empty."
        testId="pickup-no-season"
      />
    );
  }

  const [rows, unclaimed] = await Promise.all([
    listPickupCounter(season.id),
    listUnclaimedPickups(season.id),
  ]);

  const waiting = rows.filter((row) => row.pickedUpAt === null);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pickup</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {season.label} · {waiting.length} box(es) still to collect
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form action={sweepPickupReadyAction}>
            <Button type="submit" variant="secondary" data-testid="sweep-ready">
              Tell everyone whose box is in stock
            </Button>
          </form>
          <Link
            href={pickupDoorListPath()}
            className="text-sm underline underline-offset-4"
            data-testid="print-door-list"
          >
            Print the door list
          </Link>
        </div>
      </header>

      <FlashMessages notice={params.notice} problem={params.problem} testIdPrefix="pickup" />

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid="pickup-empty">
          Nobody has ordered a pickup box this season.
        </p>
      ) : (
        <table className="w-full text-sm" data-testid="pickup-table">
          <thead className="text-left text-[var(--color-ink-muted)]">
            <tr>
              <th className="py-2">Recipient</th>
              <th>Counter</th>
              <th>Ready</th>
              <th>Told</th>
              <th>Holding until</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-t border-[var(--color-line)]"
                data-testid="pickup-row"
                data-package-id={row.id}
                data-ready={row.blockedBy.length === 0}
                data-notified={row.readyAt !== null}
                data-collected={row.pickedUpAt !== null}
              >
                <td className="py-2">
                  <span className="font-medium">{row.recipientName}</span>
                  <span className="block text-[var(--color-ink-muted)]">
                    {row.customerName} · {row.orderLabel} · {row.itemCount} item(s)
                  </span>
                </td>
                <td>{row.locationName}</td>
                <td>
                  {row.blockedBy.length === 0 ? (
                    <Badge tone="success">on the shelf</Badge>
                  ) : (
                    <Badge tone="warning">{row.blockedBy.join(' and ')}</Badge>
                  )}
                </td>
                <td className="text-[var(--color-ink-muted)]">
                  {row.readyAt ? formatDate(row.readyAt) : '—'}
                </td>
                <td className="text-[var(--color-ink-muted)]">
                  {row.expiresAt ? formatDate(row.expiresAt) : '—'}
                  {row.expiredAt ? ' (over)' : ''}
                </td>
                <td>
                  {row.pickedUpAt ? (
                    <Badge tone="success">collected {formatDate(row.pickedUpAt)}</Badge>
                  ) : (
                    <span className="flex flex-wrap gap-2">
                      <form action={notifyPickupReadyAction}>
                        <input type="hidden" name="packageId" value={row.id} />
                        <Button
                          type="submit"
                          variant="secondary"
                          disabled={row.blockedBy.length > 0}
                          data-testid="notify-ready"
                        >
                          {row.readyAt ? 'Tell again' : 'Tell them it is here'}
                        </Button>
                      </form>
                      <form action={stampPickedUpAction}>
                        <input type="hidden" name="packageId" value={row.id} />
                        <Button type="submit" data-testid="stamp-collected">
                          Collected
                        </Button>
                      </form>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Nobody came ({unclaimed.length})</h2>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Past the holding date and still on the shelf. The box stays collectable — this is a list
          of people to ring, not a list of boxes to throw out.
        </p>

        {unclaimed.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]" data-testid="unclaimed-empty">
            Everything on the shelf is still within its holding time.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="unclaimed-list">
            {unclaimed.map((box) => (
              <li
                key={box.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
                data-testid="unclaimed-row"
                data-package-id={box.id}
              >
                <span>
                  <span className="font-medium">{box.recipientName}</span>
                  <span className="block text-[var(--color-ink-muted)]">
                    {box.order.customer?.fullName ?? 'Guest'} ·{' '}
                    {box.order.customer?.phone ?? 'no phone on file'} ·{' '}
                    {box.pickupLocation?.name ?? 'no counter set'}
                  </span>
                </span>
                <span className="text-[var(--color-ink-muted)]">
                  due {box.pickupExpiresAt ? formatDate(box.pickupExpiresAt) : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
