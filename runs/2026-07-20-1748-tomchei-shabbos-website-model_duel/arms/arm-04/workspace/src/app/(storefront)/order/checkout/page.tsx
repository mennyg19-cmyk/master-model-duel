import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  chooseDeliveryDayAction,
  payAction,
  saveDefaultGreetingAction,
  saveRecipientGreetingAction,
} from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/field';
import { readCheckoutSummary, type CheckoutRecipient } from '@/lib/checkout/checkout-summary';
import { formatCents } from '@/lib/core/money';
import { getCurrentCustomer } from '@/lib/customers';
import { BUILDER_PATH, type BuilderParams } from '@/lib/orders/builder-href';
import { resolveDraftOwner } from '@/lib/orders/draft-access';
import { requireOpenStore } from '@/lib/store-state';

export const dynamic = 'force-dynamic';

const GREETING_CLASSES =
  'w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm text-[var(--color-ink)]';

/**
 * Checkout (R-037).
 *
 * Everything that decides the price is shown before the button that charges it:
 * who each box is going to, what its card says, which day it goes out, and why
 * each fulfillment fee is what it is. Anything that changed under the cart —
 * a re-priced product, a box that sold out — is a panel at the top and a button
 * that refuses to pay, because a total the database disagrees with is not a
 * total.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<BuilderParams>;
}) {
  const [params, store] = await Promise.all([searchParams, requireOpenStore()]);
  const owner = await resolveDraftOwner();
  if (!owner) redirect(BUILDER_PATH);

  const [summary, customer] = await Promise.all([
    readCheckoutSummary(owner, store.season.id),
    getCurrentCustomer(),
  ]);

  if (!summary || summary.recipients.length + summary.unassignedCount === 0) redirect(BUILDER_PATH);

  return (
    <div className="space-y-6" data-testid="checkout" data-payable={summary.isPayable ? 'true' : 'false'}>
      <header className="space-y-2">
        <Badge tone="neutral">{store.season.label}</Badge>
        <h1 className="text-3xl font-semibold">Check out</h1>
        <p className="text-[var(--color-ink-muted)]">
          {summary.recipients.length} recipient{summary.recipients.length === 1 ? '' : 's'} ·{' '}
          <Link href={BUILDER_PATH} className="underline underline-offset-4">
            back to the order
          </Link>
        </p>
      </header>

      {params.notice ? (
        <p
          className="rounded-md bg-[var(--color-success-soft)] px-3 py-2 text-sm text-[var(--color-success)]"
          data-testid="checkout-notice"
        >
          {params.notice}
        </p>
      ) : null}

      {params.problem ? (
        <p
          role="alert"
          className="rounded-md bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
          data-testid="checkout-problem"
        >
          {params.problem}
        </p>
      ) : null}

      {summary.conflicts.length > 0 ? (
        <Card className="border-[var(--color-danger)]" data-testid="checkout-conflicts">
          <CardTitle>Something changed while your order was open</CardTitle>
          <CardDescription>
            These have to be sorted out before we can take a payment — the prices below are what our
            catalogue says right now.
          </CardDescription>

          <ul className="mt-3 space-y-1 text-sm text-[var(--color-danger)]">
            {summary.conflicts.map((conflict) => (
              <li key={`${conflict.lineId}-${conflict.message}`} data-testid="checkout-conflict" data-kind={conflict.kind}>
                {conflict.message}
              </li>
            ))}
          </ul>

          <p className="mt-3 text-sm">
            <Link href={BUILDER_PATH} className="underline underline-offset-4">
              Go back and fix the order
            </Link>
          </p>
        </Card>
      ) : null}

      {summary.unassignedCount > 0 ? (
        <Card className="border-[var(--color-warning)]" data-testid="checkout-unassigned">
          <CardTitle>
            {summary.unassignedCount} item{summary.unassignedCount === 1 ? '' : 's'} still need
            {summary.unassignedCount === 1 ? 's' : ''} a recipient
          </CardTitle>
          <CardDescription>
            <Link href={BUILDER_PATH} className="underline underline-offset-4">
              Say who they are for
            </Link>{' '}
            and come back.
          </CardDescription>
        </Card>
      ) : null}

      <Card data-testid="checkout-default-greeting">
        <CardTitle>The card in every box</CardTitle>
        <CardDescription>
          Write it once here. Anyone who needs a different message can have one below.
        </CardDescription>

        <form action={saveDefaultGreetingAction} className="mt-3 space-y-2">
          <input type="hidden" name="orderId" value={summary.orderId} />
          <Label htmlFor="defaultGreeting" className="sr-only">
            Card message for the whole order
          </Label>
          <textarea
            id="defaultGreeting"
            name="greetingMessage"
            rows={2}
            defaultValue={summary.defaultGreeting ?? ''}
            className={GREETING_CLASSES}
            placeholder="Freilichen Purim from the Klein family"
          />
          <Button type="submit" variant="secondary" data-testid="default-greeting-submit">
            Save for everyone
          </Button>
        </form>
      </Card>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Who is getting what</h2>
        {summary.recipients.map((recipient) => (
          <RecipientCard
            key={recipient.key}
            recipient={recipient}
            orderId={summary.orderId}
            deliveryDayChoices={summary.deliveryDayChoices}
          />
        ))}
      </section>

      <Card data-testid="checkout-totals">
        <CardTitle>Total</CardTitle>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Items</dt>
            <dd data-testid="checkout-items">{formatCents(summary.itemsCents)}</dd>
          </div>
          {summary.donationCents > 0 ? (
            <div className="flex justify-between text-[var(--color-ink-muted)]">
              <dt>Of which sponsorships</dt>
              <dd data-testid="checkout-donations">{formatCents(summary.donationCents)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt>Delivery and shipping</dt>
            <dd data-testid="checkout-fees">{formatCents(summary.fulfillmentFeeCents)}</dd>
          </div>
          <div className="flex justify-between border-t border-[var(--color-line)] pt-2 text-base font-semibold">
            <dt>To pay</dt>
            <dd data-testid="checkout-total" data-cents={summary.totalCents}>
              {formatCents(summary.totalCents)}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardTitle>Pay by card</CardTitle>
        <CardDescription>
          The card details are typed on our payment provider&rsquo;s own page — they never reach this
          site.
        </CardDescription>

        <form action={payAction} className="mt-4 space-y-4">
          <input type="hidden" name="expectedTotalCents" value={summary.totalCents} />

          {summary.isGuest ? (
            <div className="grid gap-4 sm:grid-cols-3" data-testid="checkout-contact">
              <div>
                <Label htmlFor="fullName">Your name</Label>
                <Input id="fullName" name="fullName" autoComplete="name" required />
              </div>
              <div>
                <Label htmlFor="email">Email for the receipt</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              <div>
                <Label htmlFor="phone">Phone (optional)</Label>
                <Input id="phone" name="phone" autoComplete="tel" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-ink-muted)]">
              The receipt goes to {customer?.email}.
            </p>
          )}

          <Button type="submit" disabled={!summary.isPayable} data-testid="checkout-pay">
            Pay {formatCents(summary.totalCents)}
          </Button>

          {summary.isPayable ? null : (
            <p className="text-sm text-[var(--color-danger)]" data-testid="checkout-blocked">
              {summary.missingDeliveryDayCount > 0 && summary.conflicts.length === 0
                ? 'Choose a delivery day for every delivery above.'
                : 'Sort out the notes above and this button will open.'}
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}

function RecipientCard({
  recipient,
  orderId,
  deliveryDayChoices,
}: {
  recipient: CheckoutRecipient;
  orderId: string;
  deliveryDayChoices: string[];
}) {
  const greetingFieldId = `greeting-${recipient.key}`;
  const dayFieldId = `day-${recipient.key}`;

  return (
    <Card
      data-testid="checkout-recipient"
      data-fee-cents={recipient.feeCents}
      data-box-count={recipient.boxCount}
      data-method={recipient.methodKind}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>{recipient.recipientName}</CardTitle>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {recipient.boxCount} box{recipient.boxCount === 1 ? '' : 'es'}
        </p>
      </div>

      <CardDescription>
        {recipient.methodLabel}
        {recipient.addressSummary ? ` · ${recipient.addressSummary}` : ''}
        {recipient.pickupLocationName ? ` · ${recipient.pickupLocationName}` : ''}
      </CardDescription>

      <ul className="mt-3 space-y-1 text-sm">
        {recipient.lines.map((line) => (
          <li key={line.id} className="flex justify-between">
            <span>
              {line.quantity} × {line.name}
            </span>
            <span>{formatCents(line.totalCents)}</span>
          </li>
        ))}
        <li className="flex justify-between text-[var(--color-ink-muted)]">
          <span>{recipient.feeExplanation}</span>
          <span data-testid="recipient-fee">{formatCents(recipient.feeCents)}</span>
        </li>
      </ul>

      <form action={saveRecipientGreetingAction} className="mt-4 space-y-2">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="recipientKey" value={recipient.key} />

        <Label htmlFor={greetingFieldId}>Card for {recipient.recipientName}</Label>
        <textarea
          id={greetingFieldId}
          name="greetingMessage"
          rows={2}
          defaultValue={recipient.greetingMessage ?? recipient.suggestedGreeting ?? ''}
          className={GREETING_CLASSES}
        />

        {recipient.hasMixedGreetings ? (
          <p className="text-sm text-[var(--color-warning)]" data-testid="recipient-mixed-greetings">
            These boxes carry different cards at the moment. Saving here puts the same one in each.
          </p>
        ) : null}

        {recipient.greetingMessage === null && recipient.suggestedGreeting ? (
          <p className="text-sm text-[var(--color-ink-muted)]" data-testid="recipient-remembered">
            That is what their card said last season.
          </p>
        ) : null}

        <Button type="submit" variant="secondary" data-testid="recipient-greeting-submit">
          Save this card
        </Button>
      </form>

      {recipient.needsDeliveryDay ? (
        <form
          action={chooseDeliveryDayAction}
          className="mt-4 flex flex-wrap items-end gap-2"
          data-testid="recipient-delivery-day"
          data-chosen={recipient.deliveryDay ?? ''}
        >
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="recipientKey" value={recipient.key} />

          <div className="grow">
            <Label htmlFor={dayFieldId}>Delivery day</Label>
            <Select id={dayFieldId} name="deliveryDay" defaultValue={recipient.deliveryDay ?? ''}>
              <option value="" disabled>
                Pick a day
              </option>
              {deliveryDayChoices.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </Select>
          </div>

          <Button type="submit" variant="secondary" data-testid="delivery-day-submit">
            Choose
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
