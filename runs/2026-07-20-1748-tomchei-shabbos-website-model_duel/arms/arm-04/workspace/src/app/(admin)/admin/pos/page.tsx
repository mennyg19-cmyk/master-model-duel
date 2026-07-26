import Link from 'next/link';

import { findCustomerAtCounterAction } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { formatPhone } from '@/lib/core/phone';
import { lookupCustomersForCounter } from '@/lib/customers';
import { db } from '@/lib/db';
import { openSeasonForCounter } from '@/lib/pos/counter';
import { posBuilderPath } from '@/lib/pos/paths';

export const dynamic = 'force-dynamic';

/**
 * The counter's front door (R-059, R-060).
 *
 * A POS order starts with a person, not with a product, because everything the
 * counter is for — their address book, their history, the receipt — hangs off
 * the customer record. Look them up first, and if they are new, the same form
 * creates the record and opens the till in one step.
 */
export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; notice?: string; problem?: string }>;
}) {
  const [params, staff] = await Promise.all([searchParams, requirePermission('orders.manage')]);

  const season = await openSeasonForCounter();
  const query = (params.q ?? '').trim();

  const [matches, tillRows] = await Promise.all([
    lookupCustomersForCounter(query),
    db.order.findMany({
      where: { status: 'DRAFT', posStaffUserId: staff.acting.id },
      include: { customer: { select: { id: true, fullName: true } }, _count: { select: { lines: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // A till always has a customer — the `Order_pos_has_customer` constraint says
  // so — but the relation is optional in the schema, so the narrowing is done
  // here rather than asserted at three points in the markup.
  const openTills = tillRows.flatMap((till) =>
    till.customer
      ? [{
          id: till.id,
          customerId: till.customer.id,
          customerName: till.customer.fullName,
          draftReference: till.draftReference,
          lineCount: till._count.lines,
        }]
      : [],
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Point of sale</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Ring up a walk-in. Cash and checks only — cards are taken on the customer&rsquo;s own
          payment page.
        </p>
      </header>

      <FlashMessages notice={params.notice} problem={params.problem} testIdPrefix="pos" />

      {season.ok ? (
        <Badge tone="success">{season.value.label} is open</Badge>
      ) : (
        <p role="alert" className="text-sm text-[var(--color-danger)]" data-testid="pos-closed">
          {season.publicMessage}
        </p>
      )}

      {openTills.length > 0 ? (
        <Card data-testid="pos-open-tills">
          <CardTitle>Your open carts ({openTills.length})</CardTitle>
          <CardDescription>Carts you started and have not rung up yet.</CardDescription>
          <ul className="mt-3 space-y-1 text-sm">
            {openTills.map((till) => (
              <li key={till.id}>
                <Link
                  href={posBuilderPath(till.customerId)}
                  className="text-[var(--color-brand)] underline underline-offset-4"
                >
                  {till.customerName}
                </Link>{' '}
                <span className="text-[var(--color-ink-muted)]">
                  {till.draftReference} · {till.lineCount} item{till.lineCount === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Find the customer</CardTitle>
        <CardDescription>Name, email or phone number.</CardDescription>

        <form method="get" className="mt-3 flex items-end gap-2">
          <div className="w-72">
            <Label htmlFor="pos-q">Search</Label>
            <Input id="pos-q" name="q" defaultValue={query} placeholder="Name, email or phone" />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {query === '' ? null : matches.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]" data-testid="pos-no-match">
            Nobody on file matches that. Add them below.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--color-line)] text-sm" data-testid="pos-matches">
            {matches.map((customer) => (
              <li key={customer.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">{customer.fullName}</span>
                <span className="text-[var(--color-ink-muted)]">
                  {customer.email}
                  {customer.phone ? ` · ${formatPhone(customer.phone)}` : ''}
                </span>
                <Link
                  href={posBuilderPath(customer.id)}
                  className="ml-auto text-[var(--color-brand)] underline underline-offset-4"
                  data-testid="pos-start"
                >
                  Start their order
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>New at the counter</CardTitle>
        <CardDescription>
          An email or phone number we already hold opens that customer instead of starting a second
          record for the same family.
        </CardDescription>

        <form action={findCustomerAtCounterAction} className="mt-3 grid gap-3 sm:grid-cols-4 sm:items-end">
          <div>
            <Label htmlFor="pos-fullName">Name</Label>
            <Input id="pos-fullName" name="fullName" required maxLength={120} />
          </div>
          <div>
            <Label htmlFor="pos-email">Email</Label>
            <Input id="pos-email" name="email" type="email" required />
          </div>
          <div>
            <Label htmlFor="pos-phone">Phone (optional)</Label>
            <Input id="pos-phone" name="phone" inputMode="tel" />
          </div>
          <Button type="submit" data-testid="pos-find-customer">
            Open their till
          </Button>
        </form>
      </Card>
    </div>
  );
}
