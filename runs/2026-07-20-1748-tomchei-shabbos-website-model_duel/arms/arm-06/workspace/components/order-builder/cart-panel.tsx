"use client";

import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { BuilderProduct, CartLine, DraftState, RecipientState } from "./types";
import { cartTotalCents, lineTotalCents } from "./draft-reducer";
import { SaveStatus } from "./use-auto-save";

// The cart half of the builder (R-030): line list with qty steppers and
// per-line recipient chips, recipient list, totals, save status, checkout.
// Rendered inside the desktop sidebar AND the mobile sheet — one component.
export function CartPanel({
  state,
  products,
  saveStatus,
  onSetQty,
  onRemoveLine,
  onAssign,
  onRemoveRecipient,
  onCheckout,
  checkoutBusy,
}: {
  state: DraftState;
  products: BuilderProduct[];
  saveStatus: SaveStatus;
  onSetQty: (clientId: string, qty: number) => void;
  onRemoveLine: (clientId: string) => void;
  onAssign: (clientId: string) => void;
  onRemoveRecipient: (clientId: string) => void;
  onCheckout: () => void;
  checkoutBusy: boolean;
}) {
  const total = cartTotalCents(state, products);
  const unassigned = state.lines.filter((line) => !line.recipientClientId).length;
  const recipientById = new Map(state.recipients.map((recipient) => [recipient.clientId, recipient]));

  return (
    <div className="flex h-full flex-col" data-cart-panel>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-900">Your cart</h2>
        <span className="text-xs text-stone-500" role="status" data-save-status={saveStatus}>
          {saveStatus === "saving" && "Saving…"}
          {saveStatus === "saved" && "Draft saved"}
          {saveStatus === "error" && "Save failed — will retry"}
        </span>
      </div>

      {state.lines.length === 0 ? (
        <p className="mt-6 text-sm text-stone-500">
          Add packages from the catalog, then assign each one to a recipient.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3 overflow-y-auto" aria-label="Cart lines">
          {state.lines.map((line) => (
            <CartLineRow
              key={line.clientId}
              line={line}
              product={products.find((product) => product.id === line.productId)}
              recipient={line.recipientClientId ? (recipientById.get(line.recipientClientId) ?? null) : null}
              onSetQty={onSetQty}
              onRemoveLine={onRemoveLine}
              onAssign={onAssign}
            />
          ))}
        </ul>
      )}

      {state.recipients.length > 0 && (
        <div className="mt-4 border-t border-stone-200 pt-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-stone-500">Recipients</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {state.recipients.map((recipient) => (
              <li
                key={recipient.clientId}
                className="flex items-center justify-between gap-2 text-sm"
                data-recipient={recipient.name}
              >
                <span className="truncate text-stone-700">
                  {recipient.name}
                  <span className="text-stone-400"> · {recipient.city}</span>
                  {recipient.addressId && <span className="ml-1 text-xs text-brand-600">(in address book)</span>}
                </span>
                <button
                  type="button"
                  aria-label={`Remove recipient ${recipient.name}`}
                  onClick={() => onRemoveRecipient(recipient.clientId)}
                  className="text-xs text-stone-400 hover:text-red-600"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto border-t border-stone-200 pt-4">
        <div className="flex items-center justify-between text-base font-semibold text-stone-900">
          <span>Total</span>
          <span data-cart-total>{formatCents(total)}</span>
        </div>
        {unassigned > 0 && state.lines.length > 0 && (
          <p className="mt-1 text-xs text-amber-700" role="alert">
            {unassigned} {unassigned === 1 ? "item needs" : "items need"} a recipient before checkout.
          </p>
        )}
        <Button
          className="mt-3 w-full"
          disabled={state.lines.length === 0 || unassigned > 0 || checkoutBusy}
          onClick={onCheckout}
          data-checkout-button
        >
          {checkoutBusy ? "Preparing checkout…" : "Proceed to checkout"}
        </Button>
      </div>
    </div>
  );
}

function CartLineRow({
  line,
  product,
  recipient,
  onSetQty,
  onRemoveLine,
  onAssign,
}: {
  line: CartLine;
  product: BuilderProduct | undefined;
  recipient: RecipientState | null;
  onSetQty: (clientId: string, qty: number) => void;
  onRemoveLine: (clientId: string) => void;
  onAssign: (clientId: string) => void;
}) {
  const name = product?.name ?? "Unknown package";
  const optionLabel = line.optionValueId
    ? product?.options
        .flatMap((option) => option.values.map((value) => ({ option: option.name, ...value })))
        .find((value) => value.id === line.optionValueId)
    : null;
  const addOnNames = line.addOnIds
    .map((addOnId) => product?.addOns.find((addOn) => addOn.id === addOnId)?.name)
    .filter(Boolean);

  return (
    <li className="rounded-md border border-stone-200 p-3" data-cart-line={name}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-stone-900">{name}</p>
          {optionLabel && (
            <p className="text-xs text-stone-500">
              {optionLabel.option}: {optionLabel.label}
            </p>
          )}
          {addOnNames.length > 0 && <p className="text-xs text-stone-500">+ {addOnNames.join(", ")}</p>}
        </div>
        <span className="shrink-0 text-sm font-medium text-stone-900">
          {product ? formatCents(lineTotalCents(line, product)) : "—"}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex items-center rounded-md border border-stone-300">
          <button
            type="button"
            aria-label={`Decrease ${name} quantity`}
            onClick={() => onSetQty(line.clientId, line.qty - 1)}
            className="px-2 py-0.5 text-stone-600 hover:bg-stone-100"
          >
            −
          </button>
          <span className="min-w-7 text-center text-sm">{line.qty}</span>
          <button
            type="button"
            aria-label={`Increase ${name} quantity`}
            onClick={() => onSetQty(line.clientId, line.qty + 1)}
            className="px-2 py-0.5 text-stone-600 hover:bg-stone-100"
          >
            +
          </button>
        </div>
        <button
          type="button"
          onClick={() => onAssign(line.clientId)}
          className={
            recipient
              ? "rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
              : "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200"
          }
          data-assign-chip
        >
          {recipient ? `To: ${recipient.name}` : "Assign recipient"}
        </button>
        <button
          type="button"
          aria-label={`Remove ${name} from cart`}
          onClick={() => onRemoveLine(line.clientId)}
          className="ml-auto text-xs text-stone-400 hover:text-red-600"
        >
          Remove
        </button>
      </div>
    </li>
  );
}
