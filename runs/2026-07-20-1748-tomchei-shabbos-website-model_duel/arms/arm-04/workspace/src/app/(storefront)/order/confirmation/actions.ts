'use server';

import { redirect } from 'next/navigation';

import { resumePayment } from '@/lib/checkout/checkout-service';
import { flashHref } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';
import { resolveDraftOwner } from '@/lib/orders/draft-access';

/**
 * A second run at the payment page for an order that was placed but never paid
 * — a closed tab, a declined card. The order and its reserved stock already
 * exist, so this opens another session against the same order rather than
 * starting a new one.
 */
export async function resumePaymentAction(formData: FormData): Promise<void> {
  const orderId = trimmedField(formData, 'orderId');
  const owner = await resolveDraftOwner();
  if (!owner) redirect(confirmationHref(orderId, 'Your order was not found on this browser.'));

  const resumed = await resumePayment(owner, orderId);
  if (!resumed.ok) redirect(confirmationHref(orderId, resumed.publicMessage));

  redirect(resumed.value.hostedUrl);
}

function confirmationHref(orderId: string, problem: string): string {
  return flashHref('/order/confirmation', { order: orderId, problem });
}
