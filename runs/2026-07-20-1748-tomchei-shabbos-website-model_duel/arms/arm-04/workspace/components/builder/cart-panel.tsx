"use client";

import Link from "next/link";
import { formatCents } from "@/lib/catalog";
import { Badge } from "@/components/ui/badge";
import type { Cart, PricedCart, SavedAddress } from "@/components/builder/types";

function assignmentLabel(
  assignment: Cart["lines"][number]["assignment"],
  cart: Cart,
  addressBook: SavedAddress[]
): string | null {
  if (!assignment) return null;
  if (assignment.type === "onOrder") {
    return cart.onOrderRecipient
      ? `${cart.onOrderRecipient.recipient} (on this order)`
      : "On this order";
  }
  if (assignment.type === "addressBook") {
    const saved = addressBook.find((address) => address.id === assignment.addressId);
    return saved ? `${saved.recipient} — ${saved.line1}` : "Saved recipient";
  }
  return `${assignment.address.recipient} — ${assignment.address.line1}`;
}

/**
 * The cart column (R-030): quantities first, recipients per line via the
 * three-way picker. Rendered in the desktop sidebar and the mobile drawer.
 */
export function CartPanel({
  cart,
  priced,
  addressBook,
  saveState,
  onChangeQuantity,
  onRemoveLine,
  onOpenAssignment,
}: {
  cart: Cart;
  priced: PricedCart | null;
  addressBook: SavedAddress[];
  saveState: "saved" | "saving" | "error";
  onChangeQuantity: (lineId: string, quantity: number) => void;
  onRemoveLine: (lineId: string) => void;
  onOpenAssignment: (lineId: string) => void;
}) {
  if (cart.lines.length === 0) {
    return <p className="text-sm text-muted">Your cart is empty — add packages from the left.</p>;
  }

  const pricedById = new Map((priced?.lines ?? []).map((line) => [line.id, line]));
  const unassignedCount = cart.lines.filter((line) => !line.assignment).length;

  return (
    <div className="flex flex-col gap-3" data-testid="cart-panel">
      <ul className="flex flex-col gap-3">
        {cart.lines.map((line) => {
          const pricedLine = pricedById.get(line.id);
          const label = assignmentLabel(line.assignment, cart, addressBook);
          return (
            <li key={line.id} className="rounded-md border border-border p-3" data-testid="cart-line">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{pricedLine?.productName ?? "…"}</p>
                  {pricedLine && pricedLine.optionNames.length > 0 && (
                    <p className="text-xs text-muted">{pricedLine.optionNames.join(", ")}</p>
                  )}
                  {pricedLine && pricedLine.addOnNames.length > 0 && (
                    <p className="text-xs text-muted">+ {pricedLine.addOnNames.join(", ")}</p>
                  )}
                </div>
                <p className="text-sm font-semibold text-brand-strong">
                  {pricedLine ? formatCents(pricedLine.lineTotalCents) : ""}
                </p>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <div className="flex items-center rounded-md border border-border">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    className="px-2 py-0.5 text-sm hover:bg-brand-soft"
                    onClick={() => onChangeQuantity(line.id, line.quantity - 1)}
                  >
                    −
                  </button>
                  <span className="px-2 text-sm" data-testid="line-quantity">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    className="px-2 py-0.5 text-sm hover:bg-brand-soft"
                    onClick={() => onChangeQuantity(line.id, line.quantity + 1)}
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className="ml-auto text-xs text-muted hover:text-danger"
                  onClick={() => onRemoveLine(line.id)}
                >
                  Remove
                </button>
              </div>

              <div className="mt-2 flex items-center gap-2">
                {label ? (
                  <p className="text-xs" data-testid="line-recipient">
                    → {label}
                  </p>
                ) : (
                  <Badge tone="danger">Needs recipient</Badge>
                )}
                <button
                  type="button"
                  className="ml-auto rounded-md border border-border px-2 py-0.5 text-xs font-medium hover:bg-brand-soft"
                  onClick={() => onOpenAssignment(line.id)}
                  data-testid="assign-recipient"
                >
                  {label ? "Change" : "Choose recipient"}
                </button>
              </div>

              {pricedLine && pricedLine.issues.length > 0 && (
                <p className="mt-1 text-xs text-danger">{pricedLine.issues.join("; ")}</p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between text-sm font-semibold">
          <span>Total</span>
          <span data-testid="cart-total">{priced ? formatCents(priced.totalCents) : "…"}</span>
        </div>
        <p className="mt-1 text-xs text-muted" data-testid="save-state">
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Autosave failed — retrying" : "Saved"}
        </p>
        {unassignedCount > 0 ? (
          <p className="mt-2 text-xs text-danger">
            Assign {unassignedCount === 1 ? "the remaining item" : `${unassignedCount} items`} to continue.
          </p>
        ) : (
          <Link
            href="/checkout"
            className="mt-3 block rounded-md bg-brand px-4 py-2 text-center text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Continue to checkout
          </Link>
        )}
      </div>
    </div>
  );
}
