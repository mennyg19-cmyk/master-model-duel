import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Label, Select } from '@/components/ui/field';
import { formatCents } from '@/lib/core/money';
import type { CheckoutRecipient, CheckoutSummary } from '@/lib/checkout/checkout-summary';

/**
 * One recipient at checkout: what they are getting, what it costs to get it to
 * them, the card that travels with it and — for a volunteer delivery — which
 * day it goes out.
 *
 * It takes its two actions as props for the same reason the builder panels do:
 * the counter renders this exact card against the till's own actions (R-059),
 * and a customer and a member of staff should not be looking at two different
 * spellings of the same order.
 */
const GREETING_CLASSES =
  'w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm text-[var(--color-ink)]';

export type RecipientCardActions = {
  saveGreeting: (formData: FormData) => Promise<void>;
  chooseDeliveryDay: (formData: FormData) => Promise<void>;
};

export function RecipientCard({
  recipient,
  orderId,
  deliveryDayChoices,
  actions,
}: {
  recipient: CheckoutRecipient;
  orderId: string;
  deliveryDayChoices: string[];
  actions: RecipientCardActions;
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

      <form action={actions.saveGreeting} className="mt-4 space-y-2">
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
          action={actions.chooseDeliveryDay}
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

/** The same arithmetic on both checkouts, so the counter cannot quote a different total. */
export function CheckoutTotals({ summary }: { summary: CheckoutSummary }) {
  return (
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
  );
}
