'use server';

import { revalidatePath } from 'next/cache';

import { requireSignedInCustomer } from '../../../session';
import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';
import { confirmRepeat, REMOVE_CHOICE } from '@/lib/orders/repeat-review';
import type { RepeatDecision } from '@/lib/orders/repeat-apply';

/**
 * Confirming the review page (UR-007).
 *
 * The form names its lines, and every named line becomes a decision — including
 * the ones the customer left alone, so `confirmRepeat` can tell the difference
 * between "keep what you suggested" and a line the screen forgot to render.
 */
export async function confirmRepeatAction(formData: FormData): Promise<void> {
  const customer = await requireSignedInCustomer('/account/orders');
  const sourceOrderId = trimmedField(formData, 'sourceOrderId');
  const reviewPath = `/account/orders/${sourceOrderId}/repeat`;

  const decisions = new Map<string, RepeatDecision>(
    formData.getAll('lineId').map(String).map((sourceLineId) => {
      const choice = trimmedField(formData, `product-${sourceLineId}`);
      const addressId = trimmedField(formData, `address-${sourceLineId}`);

      return [
        sourceLineId,
        {
          sourceLineId,
          productId: choice === REMOVE_CHOICE ? '' : choice,
          removed: choice === REMOVE_CHOICE,
          customerAddressId: addressId === '' ? null : addressId,
        },
      ];
    }),
  );

  const repeated = await confirmRepeat(customer.id, sourceOrderId, {
    decisions,
    replacementsConfirmed: formData.get('confirmReplacements') === 'on',
    recipientsConfirmed: formData.get('confirmRecipients') === 'on',
  });

  if (!repeated.ok) redirectWithFlash(reviewPath, { problem: repeated.publicMessage });

  revalidatePath('/order');
  redirectWithFlash('/order', {
    notice: `Your order is ready to check over: ${repeated.value.copiedLines} item${
      repeated.value.copiedLines === 1 ? '' : 's'
    } carried across${
      repeated.value.removedLines > 0 ? `, ${repeated.value.removedLines} taken off` : ''
    }.`,
  });
}
