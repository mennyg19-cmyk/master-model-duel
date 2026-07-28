"use client";

import { ReactNode } from "react";
import { formatCents } from "@/lib/money";

// R-030: mobile cart chrome — floating action button with the running
// count/total; opens the same CartPanel in a bottom sheet.
export function MobileCartFab({
  itemCount,
  totalCents,
  isOpen,
  onOpen,
  onClose,
  children,
}: {
  itemCount: number;
  totalCents: number;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open cart, ${itemCount} items, ${formatCents(totalCents)}`}
        data-mobile-cart-fab
        className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-brand-700 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-brand-600"
      >
        <span aria-hidden>🛒</span>
        <span>{itemCount}</span>
        <span aria-hidden>·</span>
        <span>{formatCents(totalCents)}</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Cart">
          <div className="absolute inset-0 bg-black/40" onClick={onClose} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl">
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                aria-label="Close cart"
                onClick={onClose}
                className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100"
              >
                ✕
              </button>
            </div>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
