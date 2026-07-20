"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CancelDraftButton({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");

  async function cancelDraft() {
    const response = await fetch(`/api/order/drafts/${draftId}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error ?? "Draft could not be cancelled.");
      return;
    }
    window.localStorage.removeItem("tomchei-p4-draft");
    router.push("/account");
    router.refresh();
  }

  return (
    <div>
      <button
        className="rounded-full border border-[var(--danger)] px-5 py-2.5 font-bold text-[var(--danger)]"
        onClick={() => void cancelDraft()}
        type="button"
      >
        Cancel draft
      </button>
      {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
