'use server';

import { z } from 'zod';

import { saveCustomerAddress } from '@/lib/addresses/address-book';
import { addressFieldsFromForm } from '@/lib/addresses/address-form';
import { requirePermission, type StaffContext } from '@/lib/auth/staff';
import { setRecipientDeliveryDay, setRecipientGreeting } from '@/lib/checkout/greetings';
import { findOrCreateCustomerAtCounter } from '@/lib/customers';
import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';
import { type BuilderParams } from '@/lib/orders/builder-href';
import { assignCartLine, unassignCartLine } from '@/lib/orders/assignment';
import { addProductToCart, removeCartLine, setLineQuantity } from '@/lib/orders/cart-service';
import { findOwnedDraft } from '@/lib/orders/draft-access';
import { discardDraft } from '@/lib/orders/order-service';
import { openSeasonForCounter, posOwner, sellAtCounter } from '@/lib/pos/counter';
import { POS_PATH, posBuilderPath, posCheckoutPath } from '@/lib/pos/paths';
import { readSetting } from '@/lib/settings';

/**
 * The counter's actions (R-059..R-061).
 *
 * Each one is the storefront action with two differences: the permission is
 * checked first, and the owner is this staff member's till rather than a
 * browser cookie. Everything between those two points — stock rules, option
 * validation, address book writes, fee resolution — is the same code the
 * website runs, which is what "POS parity" has to mean if it is to survive the
 * next change to either side (UR-006).
 *
 * The customer id is bound to the action by the page rather than posted with
 * the form, so a form replayed against another customer's till has nothing to
 * replay: it is not in the payload.
 */
export async function findCustomerAtCounterAction(formData: FormData): Promise<void> {
  const staff = await requirePermission('orders.manage');

  const found = await findOrCreateCustomerAtCounter(staff, {
    fullName: trimmedField(formData, 'fullName'),
    email: trimmedField(formData, 'email'),
    phone: trimmedField(formData, 'phone'),
  });

  if (!found.ok) redirectWithFlash(POS_PATH, { problem: found.publicMessage });

  redirectWithFlash(posBuilderPath(found.value.customer.id), {
    notice: found.value.created
      ? `Started a new record for ${found.value.customer.fullName}.`
      : `${found.value.customer.fullName} is already on file.`,
  });
}

export async function addToCartAtCounter(customerId: string, formData: FormData): Promise<void> {
  const { staff, seasonId } = await counterContext(customerId);

  const added = await addProductToCart(posOwner(staff, customerId), seasonId, {
    productId: trimmedField(formData, 'productId'),
    quantity: trimmedField(formData, 'quantity') || '1',
    optionLabels: readOptionLabels(formData),
    addOnIds: formData.getAll('addOnIds').map(String),
  });

  back(
    customerId,
    added.ok
      ? { assign: added.value.lineId, notice: 'Added. Who is this one for?' }
      : { problem: added.publicMessage },
  );
}

export async function changeQuantityAtCounter(customerId: string, formData: FormData): Promise<void> {
  const { staff } = await counterContext(customerId);

  const changed = await setLineQuantity(posOwner(staff, customerId), {
    lineId: trimmedField(formData, 'lineId'),
    quantity: Number(trimmedField(formData, 'quantity')),
  });

  back(
    customerId,
    changed.ok
      ? { notice: changed.value.removed ? 'Item removed.' : 'Quantity updated.' }
      : { problem: changed.publicMessage },
  );
}

export async function removeLineAtCounter(customerId: string, formData: FormData): Promise<void> {
  const { staff } = await counterContext(customerId);
  const removed = await removeCartLine(posOwner(staff, customerId), trimmedField(formData, 'lineId'));

  back(customerId, removed.ok ? { notice: 'Item removed.' } : { problem: removed.publicMessage });
}

export async function assignLineAtCounter(customerId: string, formData: FormData): Promise<void> {
  const { staff } = await counterContext(customerId);
  const lineId = trimmedField(formData, 'lineId');
  const target = trimmedField(formData, 'target');

  const assigned = await assignCartLine(posOwner(staff, customerId), {
    lineId,
    target,
    fulfillmentMethodId: trimmedField(formData, 'fulfillmentMethodId'),
    customerAddressId: trimmedField(formData, 'customerAddressId') || null,
    pickupLocationId: trimmedField(formData, 'pickupLocationId') || null,
    greetingMessage: trimmedField(formData, 'greetingMessage'),
    recipientName: trimmedField(formData, 'recipientName') || null,
    newAddress: addressFieldsFromForm(formData),
  });

  back(
    customerId,
    assigned.ok
      ? { notice: `Going to ${assigned.value.recipientName}.` }
      : { assign: lineId, add: target === 'new' ? '1' : null, problem: assigned.publicMessage },
  );
}

export async function unassignLineAtCounter(customerId: string, formData: FormData): Promise<void> {
  const { staff } = await counterContext(customerId);
  const cleared = await unassignCartLine(posOwner(staff, customerId), trimmedField(formData, 'lineId'));

  back(customerId, cleared.ok ? { notice: 'Recipient cleared.' } : { problem: cleared.publicMessage });
}

export async function saveAddressAtCounter(customerId: string, formData: FormData): Promise<void> {
  const staff = await requirePermission('orders.manage');
  const lineId = trimmedField(formData, 'lineId');

  const saved = await saveCustomerAddress(
    {
      customerId,
      addressId: trimmedField(formData, 'addressId') || null,
      ...addressFieldsFromForm(formData),
    },
    staff,
  );

  back(
    customerId,
    saved.ok
      ? { assign: lineId, notice: `Saved ${saved.value.address.recipientName}'s address.` }
      : {
          assign: lineId,
          editAddress: trimmedField(formData, 'addressId'),
          problem: saved.publicMessage,
        },
  );
}

export async function discardCounterCart(customerId: string): Promise<void> {
  const { staff, seasonId } = await counterContext(customerId);
  const owner = posOwner(staff, customerId);

  const draft = await findOwnedDraft(owner, seasonId);
  if (!draft) back(customerId, { problem: 'There is no open cart on this till.' });

  const discarded = await discardDraft(owner, draft.id, staff);
  if (!discarded.ok) back(customerId, { problem: discarded.publicMessage });

  redirectWithFlash(POS_PATH, { notice: `Cleared ${draft.draftReference}.` });
}

export async function saveGreetingAtCounter(customerId: string, formData: FormData): Promise<void> {
  const { staff } = await counterContext(customerId);

  const saved = await setRecipientGreeting(
    posOwner(staff, customerId),
    trimmedField(formData, 'orderId'),
    trimmedField(formData, 'recipientKey'),
    trimmedField(formData, 'greetingMessage'),
  );

  backToCheckoutWith(
    customerId,
    saved.ok ? { notice: 'Card saved.' } : { problem: saved.publicMessage },
  );
}

export async function chooseDeliveryDayAtCounter(
  customerId: string,
  formData: FormData,
): Promise<void> {
  const { staff } = await counterContext(customerId);

  const chosen = await setRecipientDeliveryDay(
    posOwner(staff, customerId),
    trimmedField(formData, 'orderId'),
    trimmedField(formData, 'recipientKey'),
    trimmedField(formData, 'deliveryDay'),
    await readSetting('delivery.dayChoices'),
  );

  backToCheckoutWith(
    customerId,
    chosen.ok ? { notice: 'Delivery day chosen.' } : { problem: chosen.publicMessage },
  );
}

const saleSchema = z.object({
  method: z.enum(['CASH', 'CHECK'], { message: 'Cash or check.' }),
  expectedTotalCents: z.coerce.number().int().nonnegative(),
});

/**
 * Cash or a check, handed over at the desk. There is no card option here on
 * purpose: a card is taken by the hosted page the customer pays on, and a POS
 * screen that pretended to take one would be collecting card details on a form
 * this project never wants to see (G-028).
 */
export async function sellAtCounterAction(customerId: string, formData: FormData): Promise<void> {
  const { staff, seasonId } = await counterContext(customerId);

  const parsed = saleSchema.safeParse({
    method: trimmedField(formData, 'method'),
    expectedTotalCents: trimmedField(formData, 'expectedTotalCents'),
  });
  if (!parsed.success) backToCheckout(customerId, parsed.error.issues[0].message);

  const sold = await sellAtCounter(staff, {
    customerId,
    seasonId,
    method: parsed.data.method,
    expectedTotalCents: parsed.data.expectedTotalCents,
    reference: trimmedField(formData, 'reference'),
  });

  if (!sold.ok) backToCheckout(customerId, sold.publicMessage);

  redirectWithFlash(`/admin/orders/${sold.value.orderId}`, {
    notice: `Order #${sold.value.orderNumber} rung up and paid at the counter.`,
  });
}

async function counterContext(customerId: string): Promise<{ staff: StaffContext; seasonId: string }> {
  const staff = await requirePermission('orders.manage');

  const season = await openSeasonForCounter();
  if (!season.ok) back(customerId, { problem: season.publicMessage });

  return { staff, seasonId: season.value.id };
}

function back(customerId: string, params: BuilderParams): never {
  redirectWithFlash(posBuilderPath(customerId), params);
}

function backToCheckout(customerId: string, problem: string): never {
  backToCheckoutWith(customerId, { problem });
}

function backToCheckoutWith(customerId: string, params: BuilderParams): never {
  redirectWithFlash(posCheckoutPath(customerId), params);
}

/** Option groups arrive as `option:Size=Large`, one field per group the product has. */
function readOptionLabels(formData: FormData): Record<string, string> {
  const labels: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (key.startsWith('option:')) labels[key.slice('option:'.length)] = String(value);
  }

  return labels;
}
