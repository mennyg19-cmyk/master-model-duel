"use client";

import { ReactNode } from "react";

// R-030: desktop cart chrome — the sidebar column. Content lives in
// CartPanel so mobile renders the exact same thing in its sheet.
export function OrderSidebar({ children }: { children: ReactNode }) {
  return (
    <aside
      className="hidden w-[360px] shrink-0 lg:block"
      aria-label="Order cart"
      data-desktop-sidebar
    >
      <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
        {children}
      </div>
    </aside>
  );
}
