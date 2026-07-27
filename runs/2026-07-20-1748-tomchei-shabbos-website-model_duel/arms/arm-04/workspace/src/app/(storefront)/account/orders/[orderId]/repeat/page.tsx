import Link from 'next/link';

import { requireSignedInCustomer } from '../../../session';
import { confirmRepeatAction } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { formatCents } from '@/lib/core/money';
import type { RepeatLinePlan, RepeatPlan } from '@/lib/orders/repeat-plan';
import { readRepeatReview, REMOVE_CHOICE } from '@/lib/orders/repeat-review';

export const dynamic = 'force-dynamic';

/**
 * The page between "same as last year" and a cart (UR-007, G-011, G-012).
 *
 * Nothing is written by looking at it. Every line says what it was, what it
 * would become and who it is going to, and the two ticks at the bottom are the
 * customer saying they read both halves — because the two things that go wrong
 * in a repeat are a swapped item nobody noticed and a card sent to an address
 * the family moved out of.
 */
export default async function RepeatReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ problem?: string }>;
}) {
  const [{ orderId }, flash, customer] = await Promise.all([
    params,
    searchParams,
    requireSignedInCustomer('/account/orders'),
  ]);

  const review = await readRepeatReview(customer.id, orderId);
  if (!review.ok) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold">Order again</h1>
        <p role="alert" className="text-[var(--color-danger)]" data-testid="repeat-blocked">
          {review.publicMessage}
        </p>
        <Link href="/account/orders" className="text-sm underline underline-offset-4">
          Back to your orders
        </Link>
      </div>
    );
  }

  const { plan } = review.value;

  return (
    <div className="space-y-6" data-testid="repeat-review">
      <header className="space-y-2">
        <p className="text-sm text-[var(--color-ink-muted)]">
          <Link href={`/account/orders/${orderId}`} className="underline underline-offset-4">
            {plan.sourceLabel}
          </Link>
        </p>
        <h1 className="text-3xl font-semibold">Order again for {plan.targetSeasonLabel}</h1>
        <p className="text-[var(--color-ink-muted)]">
          This is your {plan.sourceSeasonLabel} order at this year&apos;s prices. Nothing is ordered
          until you confirm below.
        </p>
      </header>

      <FlashMessages problem={flash.problem} testIdPrefix="repeat" />

      <Headline plan={plan} />

      <form action={confirmRepeatAction} className="space-y-4">
        <input type="hidden" name="sourceOrderId" value={plan.sourceOrderId} />

        <ul className="space-y-3">
          {plan.lines.map((line) => (
            <LineCard key={line.sourceLineId} line={line} plan={plan} />
          ))}
        </ul>

        <div className="space-y-2 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="confirmReplacements" className="mt-1" data-testid="confirm-replacements" />
            <span>
              I have checked the items. Where something is no longer sold, I have chosen what takes
              its place or taken it off.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="confirmRecipients" className="mt-1" data-testid="confirm-recipients" />
            <span>I have checked who each one is going to.</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" data-testid="repeat-confirm">
            Build my order
          </Button>
          <Link href="/account/orders" className="text-sm underline underline-offset-4">
            Not now
          </Link>
        </div>
      </form>
    </div>
  );
}

function Headline({ plan }: { plan: RepeatPlan }) {
  const problems = [
    plan.needsChoiceCount > 0
      ? `${plan.needsChoiceCount} item${plan.needsChoiceCount === 1 ? ' is' : 's are'} not sold this year`
      : null,
    plan.recipientProblemCount > 0
      ? `${plan.recipientProblemCount} recipient${plan.recipientProblemCount === 1 ? ' needs' : 's need'} an address`
      : null,
  ].filter((line): line is string => line !== null);

  return (
    <p
      className={
        problems.length === 0
          ? 'text-sm text-[var(--color-ink-muted)]'
          : 'rounded-md bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[var(--color-warning)]'
      }
      data-testid="repeat-headline"
      data-needs-choice={plan.needsChoiceCount}
    >
      {problems.length === 0
        ? 'Everything you ordered last time is still available.'
        : `${problems.join(', and ')}. Sort those out below.`}
    </p>
  );
}

function LineCard({ line, plan }: { line: RepeatLinePlan; plan: RepeatPlan }) {
  const needsAddress = line.recipient.state === 'address_missing';

  return (
    <li
      className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4"
      data-testid="repeat-line"
      data-resolution={line.resolution}
      data-recipient-state={line.recipient.state}
    >
      <input type="hidden" name="lineId" value={line.sourceLineId} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {line.quantity} × {line.sourceName}
        </p>
        <p className="text-sm text-[var(--color-ink-muted)]">
          was {formatCents(line.lastUnitPriceCents)} each
        </p>
      </div>

      {line.resolution === 'mapped' && line.product ? (
        <p className="text-sm" data-testid="repeat-swap">
          <Badge tone="warning">Changed</Badge>{' '}
          {line.viaNames.length > 0
            ? `${line.sourceName} became ${line.product.name}.`
            : `This year it is ${line.product.name}.`}
        </p>
      ) : null}

      <label className="block text-sm">
        <span className="mb-1 block font-medium">This year</span>
        <Select
          name={`product-${line.sourceLineId}`}
          defaultValue={line.product?.id ?? ''}
          className="max-w-md"
          data-testid="repeat-product"
        >
          {line.product === null ? (
            <option value="">Choose what to send instead</option>
          ) : null}
          {plan.catalog.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} · {formatCents(product.priceCents)}
              {product.id === line.suggestion?.id ? ' · closest to what you paid' : ''}
            </option>
          ))}
          <option value={REMOVE_CHOICE}>Do not send this one</option>
        </Select>
      </label>

      <div className="text-sm">
        <span className="font-medium">Going to </span>
        <span data-testid="repeat-recipient">{line.recipient.name}</span>
        {line.recipient.methodLabel ? ` · ${line.recipient.methodLabel}` : ''}
        {line.recipient.addressSummary ? (
          <span className="block text-[var(--color-ink-muted)]">{line.recipient.addressSummary}</span>
        ) : null}

        {line.recipient.state === 'method_missing' ? (
          <span className="block text-[var(--color-warning)]">
            How this one was sent last time is not offered any more. You can pick delivery or
            shipping for it once the order is built.
          </span>
        ) : null}
      </div>

      {needsAddress ? (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-[var(--color-warning)]">
            This address is not in your book any more
          </span>
          <Select
            name={`address-${line.sourceLineId}`}
            defaultValue=""
            className="max-w-md"
            data-testid="repeat-address"
          >
            <option value="">Choose where it should go</option>
            {plan.addressBook.map((address) => (
              <option key={address.id} value={address.id}>
                {address.summary}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      {line.greetingMessage ? (
        <p className="text-sm text-[var(--color-ink-muted)]" data-testid="repeat-greeting">
          Card: “{line.greetingMessage}”
        </p>
      ) : null}

      {line.droppedAddOnNames.length > 0 ? (
        <p className="text-sm text-[var(--color-warning)]">
          Not available this year: {line.droppedAddOnNames.join(', ')}.
        </p>
      ) : null}
    </li>
  );
}
