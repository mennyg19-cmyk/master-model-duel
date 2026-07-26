import Link from 'next/link';

import { OrderQueue } from './order-queue';
import { readActiveSeason, readTodayQueue } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';

export const dynamic = 'force-dynamic';

/**
 * R-050. The day's work, in the order it should be picked up.
 *
 * Money first, because an unpaid order is a phone call and everything else is
 * warehouse work. Open tills are last and are the only queue that is about the
 * staff rather than the customers: a cart left open at the counter is invisible
 * everywhere else, and it holds no stock, so somebody has to close it.
 */
export default async function TodayPage() {
  await requirePermission('orders.view');

  const season = await readActiveSeason();
  if (!season) {
    return <p className="text-sm text-[var(--color-ink-muted)]">No season has been set up yet.</p>;
  }

  const queue = await readTodayQueue(season.id);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Today</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {season.label} — what is waiting on somebody in the office.
        </p>
      </header>

      <OrderQueue
        testId="today-awaiting"
        title="Waiting on payment"
        empty="Nothing is owing."
        rows={queue.awaitingPayment}
      />

      <OrderQueue
        testId="today-ready"
        title="Paid, ready to pack"
        empty="Nothing is waiting to be packed."
        rows={queue.readyToPack}
      />

      <section
        className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4"
        data-testid="today-tills"
        data-count={queue.openTills.length}
      >
        <h3 className="text-sm font-semibold">Carts open at the counter ({queue.openTills.length})</h3>

        {queue.openTills.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Every till is clear.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--color-line)] text-sm">
            {queue.openTills.map((till) => (
              <li key={till.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">{till.draftReference}</span>
                <span>{till.customerName}</span>
                <span className="text-[var(--color-ink-muted)]">
                  {till.itemCount} item{till.itemCount === 1 ? '' : 's'}
                </span>
                <Link
                  href="/admin/pos"
                  className="ml-auto text-[var(--color-brand)] underline underline-offset-4"
                >
                  Point of sale
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
