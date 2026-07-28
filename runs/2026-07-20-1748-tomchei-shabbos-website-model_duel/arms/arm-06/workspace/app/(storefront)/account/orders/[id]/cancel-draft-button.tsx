"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

// R-040: cancel a draft (DISCARDED server-side). Ownership is enforced by the
// drafts route; after cancel the order disappears from history views.
export function CancelDraftButton({ draftRef }: { draftRef: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm(`Cancel draft ${draftRef}? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    const result = await apiFetch(`/api/drafts/${encodeURIComponent(draftRef)}`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) {
      setError(result.body.error ?? "Could not cancel the draft");
      return;
    }
    router.push("/account/orders");
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={cancel}
        disabled={busy}
        className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        data-cancel-draft
      >
        {busy ? "Cancelling…" : "Cancel draft"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </span>
  );
}
