"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

/** Staff schedules the bulk drop; the API notifies each customer once (R-078). */
export function BulkDeliveryForm() {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [window, setWindow] = useState("12:00–16:00");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
          const result = await apiFetch<{ customers: number }>("/api/admin/bulk-delivery", {
            body: { date, window },
          });
          setMessage(
            result.ok
              ? `Scheduled — ${result.body.customers} customer(s) notified by email + SMS.`
              : result.error
          );
          if (result.ok) router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Delivery date</span>
        <input
          type="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="rounded-md border border-border px-2 py-1.5 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Window</span>
        <input
          required
          value={window}
          onChange={(event) => setWindow(event.target.value)}
          className="rounded-md border border-border px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-brand-soft disabled:opacity-50"
      >
        Schedule + notify
      </button>
      {message && <p className="text-sm text-muted" data-testid="bulk-delivery-message">{message}</p>}
    </form>
  );
}
