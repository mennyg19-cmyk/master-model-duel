'use server';

import { redirect } from 'next/navigation';

import { z } from 'zod';

import {
  setDefaultGreeting,
  setRecipientDeliveryDay,
  setRecipientGreeting,
} from '@/lib/checkout/greetings';
import { startCheckout } from '@/lib/checkout/checkout-service';
import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';
import { CHECKOUT_PATH, type BuilderParams } from '@/lib/orders/builder-href';
import { resolveDraftOwner, type DraftOwner } from '@/lib/orders/draft-access';
import { readSetting } from '@/lib/settings';
import { requireOpenStore } from '@/lib/store-state';

/**
 * Checkout answers the way the builder does — every card is its own form, and
 * the outcome comes back on the query string — because the page is a list of
 * small independent edits: this recipient's card, that recipient's day. The one
 * exception is paying, which leaves for the payment page instead of coming back.
 */
export async function saveDefaultGreetingAction(formData: FormData): Promise<void> {
  const { owner } = await checkoutContext();

  const saved = await setDefaultGreeting(
    owner,
    trimmedField(formData, 'orderId'),
    trimmedField(formData, 'greetingMessage'),
  );

  back(
    saved.ok
      ? {
          notice:
            saved.value.appliedToLines === 0
              ? 'Saved. Every recipient already has their own card.'
              : 'Saved, and used for everyone without their own card.',
        }
      : { problem: saved.publicMessage },
  );
}

export async function saveRecipientGreetingAction(formData: FormData): Promise<void> {
  const { owner } = await checkoutContext();

  const saved = await setRecipientGreeting(
    owner,
    trimmedField(formData, 'orderId'),
    trimmedField(formData, 'recipientKey'),
    trimmedField(formData, 'greetingMessage'),
  );

  back(saved.ok ? { notice: 'Card saved.' } : { problem: saved.publicMessage });
}

export async function chooseDeliveryDayAction(formData: FormData): Promise<void> {
  const { owner } = await checkoutContext();

  const chosen = await setRecipientDeliveryDay(
    owner,
    trimmedField(formData, 'orderId'),
    trimmedField(formData, 'recipientKey'),
    trimmedField(formData, 'deliveryDay'),
    await readSetting('delivery.dayChoices'),
  );

  back(chosen.ok ? { notice: 'Delivery day chosen.' } : { problem: chosen.publicMessage });
}

/**
 * The total is submitted with the form so the server can refuse to charge a
 * number the customer never saw (R-034). It is a claim about what was on the
 * screen, never the amount charged: that comes from the order.
 */
const expectedTotalSchema = z.coerce.number().int().nonnegative();

export async function payAction(formData: FormData): Promise<void> {
  const { owner, seasonId } = await checkoutContext();

  const expectedTotalCents = expectedTotalSchema.safeParse(
    trimmedField(formData, 'expectedTotalCents'),
  );
  if (!expectedTotalCents.success) {
    back({ problem: 'The total changed while you were checking out. Look it over and try again.' });
  }

  const started = await startCheckout(owner, seasonId, {
    expectedTotalCents: expectedTotalCents.data,
    contact: {
      fullName: trimmedField(formData, 'fullName'),
      email: trimmedField(formData, 'email'),
      phone: trimmedField(formData, 'phone'),
    },
  });

  if (!started.ok) back({ problem: started.publicMessage });
  redirect(started.value.hostedUrl);
}

async function checkoutContext(): Promise<{ owner: DraftOwner; seasonId: string }> {
  const store = await requireOpenStore();
  const owner = await resolveDraftOwner();
  if (!owner) back({ problem: 'Your order was not found on this browser.' });

  return { owner, seasonId: store.season.id };
}

function back(params: BuilderParams): never {
  redirectWithFlash(CHECKOUT_PATH, params);
}
