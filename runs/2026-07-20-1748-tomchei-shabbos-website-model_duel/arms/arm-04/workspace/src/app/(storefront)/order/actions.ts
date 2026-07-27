'use server';

import { saveCustomerAddress } from '@/lib/addresses/address-book';
import { addressFieldsFromForm } from '@/lib/addresses/address-form';
import { getCurrentCustomer } from '@/lib/customers';
import { redirectWithFlash } from '@/lib/forms/flash-redirect';
import { trimmedField } from '@/lib/forms/form-data';
import { assignCartLine, unassignCartLine } from '@/lib/orders/assignment';
import { addProductToCart, removeCartLine, setLineQuantity } from '@/lib/orders/cart-service';
import { BUILDER_PATH, type BuilderParams } from '@/lib/orders/builder-href';
import { resolveDraftOwner, resolveDraftOwnerForWrite } from '@/lib/orders/draft-access';
import { requireOpenStore } from '@/lib/http/store-gate';

/**
 * The builder is one page with a form on every card and every cart line, so its
 * actions answer the way a plain HTML page does: they redirect back to the
 * builder with the outcome in the query string, and the page shows it once at the
 * top. A `useActionState` hook per form would be a dozen client components and
 * still could not report a cart-level problem in one place. Single-form pages —
 * the account and admin screens — keep the hook.
 */
export async function addToCartAction(formData: FormData): Promise<void> {
  const store = await requireOpenStore();
  const owner = await resolveDraftOwnerForWrite();

  const added = await addProductToCart(owner, store.season.id, {
    productId: trimmedField(formData, 'productId'),
    quantity: trimmedField(formData, 'quantity') || '1',
    optionLabels: readOptionLabels(formData),
    addOnIds: formData.getAll('addOnIds').map(String),
  });

  // Straight into the picker: the point of a cart-first builder is that choosing
  // the box and choosing the person are two separate steps, not that the second
  // one is easy to forget.
  back(
    added.ok
      ? { assign: added.value.lineId, notice: 'Added. Who is this one for?' }
      : { product: trimmedField(formData, 'slug'), problem: added.publicMessage },
  );
}

export async function changeQuantityAction(formData: FormData): Promise<void> {
  const owner = await requireOwner();

  const changed = await setLineQuantity(owner, {
    lineId: trimmedField(formData, 'lineId'),
    quantity: Number(trimmedField(formData, 'quantity')),
  });

  back(
    changed.ok
      ? { notice: changed.value.removed ? 'Item removed.' : 'Quantity updated.' }
      : { problem: changed.publicMessage },
  );
}

export async function removeLineAction(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const removed = await removeCartLine(owner, trimmedField(formData, 'lineId'));

  back(removed.ok ? { notice: 'Item removed.' } : { problem: removed.publicMessage });
}

export async function assignLineAction(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const lineId = trimmedField(formData, 'lineId');
  const target = trimmedField(formData, 'target');

  const assigned = await assignCartLine(owner, {
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
    assigned.ok
      ? { notice: `Going to ${assigned.value.recipientName}.` }
      : { assign: lineId, add: target === 'new' ? '1' : null, problem: assigned.publicMessage },
  );
}

export async function unassignLineAction(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const cleared = await unassignCartLine(owner, trimmedField(formData, 'lineId'));

  back(
    cleared.ok
      ? { notice: 'Recipient cleared. The item is still in your order.' }
      : { problem: cleared.publicMessage },
  );
}

/**
 * Editing a saved address from inside the order (R-024, R-029). It is on the
 * builder, so it is gated like the rest of the builder: a closed store answers
 * the same way here as it does for every other action on this page.
 */
export async function saveBuilderAddressAction(formData: FormData): Promise<void> {
  await requireOpenStore();

  const customer = await getCurrentCustomer();
  const lineId = trimmedField(formData, 'lineId');

  if (!customer) {
    back({ assign: lineId, problem: 'Sign in to change a saved address.' });
    return;
  }

  const saved = await saveCustomerAddress({
    customerId: customer.id,
    addressId: trimmedField(formData, 'addressId') || null,
    ...addressFieldsFromForm(formData),
  });

  back(
    saved.ok
      ? { assign: lineId, notice: `Saved ${saved.value.address.recipientName}'s address.` }
      : {
          assign: lineId,
          editAddress: trimmedField(formData, 'addressId'),
          problem: saved.publicMessage,
        },
  );
}

/**
 * A write needs an existing cart. Nothing is created here — that would hand a
 * guest token to anyone who posts a stray form — so a request with no cart is
 * sent back to an empty builder.
 */
async function requireOwner() {
  await requireOpenStore();
  const owner = await resolveDraftOwner();
  if (!owner) back({ problem: 'Your order was not found on this browser. Start it again below.' });

  return owner;
}

function back(params: BuilderParams): never {
  redirectWithFlash(BUILDER_PATH, params);
}

/** Option groups arrive as `option:Size=Large`, one field per group the product has. */
function readOptionLabels(formData: FormData): Record<string, string> {
  const labels: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (key.startsWith('option:')) labels[key.slice('option:'.length)] = String(value);
  }

  return labels;
}
