"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

/** Staff single-order repeat (R-057): copy this order into the customer's POS draft and jump there. */
export function RepeatOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function repeat() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiFetch<{ added: number; skipped: string[]; suggested: string[]; posUrl: string }>(
        `/api/admin/orders/${orderId}/repeat`,
        { method: "POST", body: {} }
      );
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      const notes: string[] = [];
      if (result.body.suggested.length > 0) notes.push(`price-suggested: ${result.body.suggested.join(", ")}`);
      if (result.body.skipped.length > 0) notes.push(`skipped (nothing available): ${result.body.skipped.join(", ")}`);
      if (notes.length > 0) setMessage(notes.join(" · "));
      router.push(result.body.posUrl);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="secondary" onClick={repeat} disabled={busy} data-testid="staff-repeat-button">
        {busy ? "Copying…" : "Repeat in POS"}
      </Button>
      {message && <span className="text-xs text-muted">{message}</span>}
    </span>
  );
}
