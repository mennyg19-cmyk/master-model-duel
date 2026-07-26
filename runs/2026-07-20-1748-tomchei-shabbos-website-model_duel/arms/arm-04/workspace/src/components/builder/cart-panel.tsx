import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/core/money';
import type { Cart, CartLine } from '@/lib/orders/cart';

export type CartPanelActions = {
  changeQuantity: (formData: FormData) => Promise<void>;
  removeLine: (formData: FormData) => Promise<void>;
  unassignLine: (formData: FormData) => Promise<void>;
};

/**
 * The cart, drawn once and placed twice: pinned beside the catalogue on a desktop
 * and behind the floating button on a phone (R-030). Both copies are the same
 * markup with a different wrapper, so what a customer sees cannot depend on the
 * width of their screen.
 */
export function CartPanel({
  cart,
  actions,
  assignHref,
  checkoutHref,
  className,
  testId,
}: {
  cart: Cart | null;
  actions: CartPanelActions;
  assignHref: (lineId: string) => string;
  checkoutHref: string | null;
  className?: string;
  testId: string;
}) {
  return (
    <section
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4',
        className,
      )}
      data-testid={testId}
      data-item-count={cart?.itemCount ?? 0}
      data-unassigned-count={cart?.unassignedCount ?? 0}
      aria-label="Your order"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Your order</h2>
        {cart ? (
          <span className="text-xs text-[var(--color-ink-muted)]" data-testid="draft-reference">
            {cart.draftReference}
          </span>
        ) : null}
      </div>

      {!cart || cart.lines.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
          Nothing here yet. Pick the packages you want first — you say who each one is going to
          afterwards.
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-3">
            {cart.lines.map((line) => (
              <CartLineRow key={line.id} line={line} actions={actions} assignHref={assignHref} />
            ))}
          </ul>

          <dl className="mt-4 space-y-1 border-t border-[var(--color-line)] pt-3 text-sm">
            <div className="flex justify-between font-medium">
              <dt>Items</dt>
              <dd data-testid="cart-subtotal">{formatCents(cart.subtotalCents)}</dd>
            </div>
            <div className="flex justify-between text-[var(--color-ink-muted)]">
              <dt>Delivery and shipping</dt>
              <dd>Worked out at checkout</dd>
            </div>
          </dl>

          {cart.unassignedCount > 0 ? (
            <p className="mt-3 text-sm text-[var(--color-warning)]" data-testid="cart-unassigned">
              {cart.unassignedCount === 1
                ? '1 item still needs a recipient.'
                : `${cart.unassignedCount} items still need a recipient.`}
            </p>
          ) : (
            <p className="mt-3 text-sm text-[var(--color-success)]" data-testid="cart-ready">
              Every item has a recipient.
            </p>
          )}

          {checkoutHref ? (
            <Link href={checkoutHref} className="mt-3 block">
              <Button className="w-full" disabled={!cart.isReadyForCheckout}>
                Continue to checkout
              </Button>
            </Link>
          ) : (
            <p className="mt-3 text-xs text-[var(--color-ink-muted)]" data-testid="checkout-pending">
              Payment and delivery scheduling arrive in the next release. Your order is saved as{' '}
              {cart.draftReference} and will be waiting.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function CartLineRow({
  line,
  actions,
  assignHref,
}: {
  line: CartLine;
  actions: CartPanelActions;
  assignHref: (lineId: string) => string;
}) {
  return (
    <li
      className="rounded-md border border-[var(--color-line)] p-3"
      data-testid="cart-line"
      data-line-id={line.id}
      data-assigned={line.assignment ? 'true' : 'false'}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{line.name}</p>
          {line.options.length > 0 ? (
            <p className="text-xs text-[var(--color-ink-muted)]">
              {line.options.map((option) => `${option.groupLabel}: ${option.label}`).join(' · ')}
            </p>
          ) : null}
          {line.addOns.map((addOn) => (
            <p key={addOn.id} className="text-xs text-[var(--color-ink-muted)]">
              + {addOn.name}
            </p>
          ))}
        </div>
        <p className="font-medium" data-testid="cart-line-total">
          {formatCents(line.totalCents)}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <form action={actions.changeQuantity} className="flex items-center gap-1">
          <input type="hidden" name="lineId" value={line.id} />
          <Input
            name="quantity"
            type="number"
            min={1}
            max={99}
            defaultValue={line.quantity}
            className="w-16"
            aria-label={`Quantity of ${line.name}`}
          />
          <Button type="submit" variant="secondary">
            Update
          </Button>
        </form>

        <form action={actions.removeLine}>
          <input type="hidden" name="lineId" value={line.id} />
          <Button type="submit" variant="ghost" data-testid="cart-line-remove">
            Remove
          </Button>
        </form>
      </div>

      {line.assignment ? (
        <div className="mt-2 space-y-1 text-sm" data-testid="cart-line-assignment">
          <p className="font-medium">{line.assignment.recipientName}</p>
          <p className="text-[var(--color-ink-muted)]">
            {line.assignment.methodLabel}
            {line.assignment.addressSummary ? ` · ${line.assignment.addressSummary}` : ''}
            {line.assignment.pickupLocationName ? ` · ${line.assignment.pickupLocationName}` : ''}
          </p>
          {line.assignment.greetingMessage ? (
            <p className="text-[var(--color-ink-muted)]">“{line.assignment.greetingMessage}”</p>
          ) : null}
          <div className="flex gap-3">
            <Link
              href={assignHref(line.id)}
              className="text-[var(--color-brand)] underline underline-offset-4"
              data-testid="cart-line-change"
            >
              Change recipient
            </Link>
            <form action={actions.unassignLine}>
              <input type="hidden" name="lineId" value={line.id} />
              <button type="submit" className="underline underline-offset-4">
                Clear
              </button>
            </form>
          </div>
        </div>
      ) : (
        <p className="mt-2">
          <Badge tone="warning">Needs a recipient</Badge>{' '}
          <Link
            href={assignHref(line.id)}
            className="ml-1 text-sm font-medium text-[var(--color-brand)] underline underline-offset-4"
            data-testid="cart-line-assign"
          >
            Choose who this is for
          </Link>
        </p>
      )}
    </li>
  );
}
