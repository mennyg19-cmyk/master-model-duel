"use client";

import { useState } from "react";
import Link from "next/link";
import { OrderBuilderShell } from "@/components/order/builder-shell";
import { PosCustomerPanel } from "@/components/admin/pos-customer-panel";

export function PosPageClient() {
  const [draftRef, setDraftRef] = useState<string | null>(null);

  return (
    <main className="min-h-screen bg-[var(--color-cream)]" data-testid="pos-builder">
      <div className="flex items-center justify-between border-b bg-white px-4 py-3 text-sm font-semibold text-[var(--color-forest)]">
        <span>POS · cart-first builder + cash/check</span>
        <Link href="/admin" className="text-xs font-semibold text-[var(--color-leaf)]">
          ← Admin home
        </Link>
      </div>
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-4">
        <PosCustomerPanel draftRef={draftRef} />
      </div>
      <OrderBuilderShell mode="pos" onDraftChange={(d) => setDraftRef(d?.draftRef ?? null)} />
      <p className="px-4 pb-8 text-center text-xs text-[var(--color-ink)]/60">
        After assigning recipients, open{" "}
        <Link href="/checkout?mode=pos" className="font-semibold text-[var(--color-leaf)]">
          POS checkout
        </Link>{" "}
        for cash/check with staff audit.
      </p>
    </main>
  );
}
