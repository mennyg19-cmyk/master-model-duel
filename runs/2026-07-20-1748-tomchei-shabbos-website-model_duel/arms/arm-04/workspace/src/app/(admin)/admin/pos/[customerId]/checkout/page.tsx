import { notFound, redirect } from 'next/navigation';

import {
  chooseDeliveryDayAtCounter,
  saveGreetingAtCounter,
  sellAtCounterAction,
} from '../../actions';
import { BackLink } from '@/components/admin/list-controls';
import { CheckoutTotals, RecipientCard } from '@/components/checkout/recipient-card';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { readCheckoutSummary } from '@/lib/checkout/checkout-summary';
import { formatCents } from '@/lib/core/money';
import { db } from '@/lib/db';
import type { BuilderParams } from '@/lib/orders/builder-href';
import { openSeasonForCounter, posOwner } from '@/lib/pos/counter';
import { posBuilderPath } from '@/lib/pos/paths';

export const dynamic = 'force-dynamic';

/**
 * Ringing it up (R-061, UR-011, G-028).
 *
 * The same summary the website shows, priced by the same engine, with one
 * difference at the bottom: the money is handed over here and now, in cash or
 * by check, and the row that records it carries the name of the member of staff
 * who took it. There is no card field — a card goes through the customer's own
 * hosted payment page, and a POS screen that collected one would be the exact
 * thing this project has kept off its own servers all the way through.
 */
export default async function PosCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<BuilderParams>;
}) {
  const [{ customerId }, query, staff] = await Promise.all([
    params,
    searchParams,
    requirePermission('orders.manage'),
  ]);

  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) notFound();

  const season = await openSeasonForCounter();
  if (!season.ok) redirect(posBuilderPath(customerId));

  const summary = await readCheckoutSummary(posOwner(staff, customerId), season.value.id);
  if (!summary) redirect(posBuilderPath(customerId));

  const recipientActions = {
    saveGreeting: saveGreetingAtCounter.bind(null, customerId),
    chooseDeliveryDay: chooseDeliveryDayAtCounter.bind(null, customerId),
  };

  return (
    <div
      className="space-y-6"
      data-testid="pos-checkout"
      data-payable={summary.isPayable ? 'true' : 'false'}
    >
      <BackLink href={posBuilderPath(customerId)}>Back to the order</BackLink>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Ring up {customer.fullName}</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {summary.draftReference} · {summary.recipients.length} recipient
          {summary.recipients.length === 1 ? '' : 's'}
        </p>
      </header>

      <FlashMessages notice={query.notice} problem={query.problem} testIdPrefix="checkout" />

      {summary.conflicts.length > 0 ? (
        <Card className="border-[var(--color-danger)]" data-testid="checkout-conflicts">
          <CardTitle>Something changed while this cart was open</CardTitle>
          <CardDescription>The catalogue moved under the order. Fix these first.</CardDescription>
          <ul className="mt-3 space-y-1 text-sm text-[var(--color-danger)]">
            {summary.conflicts.map((conflict) => (
              <li key={`${conflict.lineId}-${conflict.message}`} data-testid="checkout-conflict" data-kind={conflict.kind}>
                {conflict.message}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Who is getting what</h2>
        {summary.recipients.map((recipient) => (
          <RecipientCard
            key={recipient.key}
            recipient={recipient}
            orderId={summary.orderId}
            deliveryDayChoices={summary.deliveryDayChoices}
            actions={recipientActions}
          />
        ))}
      </section>

      <CheckoutTotals summary={summary} />

      <Card>
        <CardTitle>Take the payment</CardTitle>
        <CardDescription>
          Cash or a check, in full. The order is placed and paid in one step, and the payment row
          carries your name.
        </CardDescription>

        <form action={sellAtCounterAction.bind(null, customerId)} className="mt-4 space-y-4">
          <input type="hidden" name="expectedTotalCents" value={summary.totalCents} />

          <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <div>
              <Label htmlFor="pos-method">Method</Label>
              <Select id="pos-method" name="method" defaultValue="CASH">
                <option value="CASH">Cash</option>
                <option value="CHECK">Check</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="pos-reference">Check number or receipt</Label>
              <Input id="pos-reference" name="reference" maxLength={60} />
            </div>
            <Button type="submit" disabled={!summary.isPayable} data-testid="pos-sell">
              Take {formatCents(summary.totalCents)}
            </Button>
          </div>

          {summary.isPayable ? null : (
            <p className="text-sm text-[var(--color-danger)]" data-testid="checkout-blocked">
              {summary.unassignedCount > 0
                ? `${summary.unassignedCount} item${summary.unassignedCount === 1 ? ' still needs' : 's still need'} a recipient.`
                : summary.missingDeliveryDayCount > 0 && summary.conflicts.length === 0
                  ? 'Choose a delivery day for every delivery above.'
                  : 'Sort out the notes above and this button will open.'}
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}
