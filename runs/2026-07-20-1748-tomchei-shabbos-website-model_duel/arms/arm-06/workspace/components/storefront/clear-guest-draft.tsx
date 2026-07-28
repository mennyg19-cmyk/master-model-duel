"use client";

import { useEffect } from "react";
import { clearGuestDraft } from "@/components/order-builder/use-auto-save";

// R-022: the guest's localStorage draft copy is cleared ONLY when the bound
// order has left DRAFT state (success) — never on refresh, never while the
// draft is still open. The server decides `shouldClear`; the smoke probe
// reads the data attribute as evidence (S2).
export function ClearGuestDraftOnSuccess({ shouldClear }: { shouldClear: boolean }) {
  useEffect(() => {
    if (shouldClear) {
      clearGuestDraft();
    }
  }, [shouldClear]);

  return <span hidden data-clear-guest-draft={shouldClear ? "true" : "false"} />;
}
