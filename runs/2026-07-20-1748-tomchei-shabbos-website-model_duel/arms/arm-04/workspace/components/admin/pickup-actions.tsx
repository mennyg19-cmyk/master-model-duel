"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

// Client controls for the pickup door (G-017, G-026): ready sweep + the
// picked-up stamp (which is the existing stage machine's PICKED_UP move).

const button = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-brand-soft disabled:opacity-50";

export function PickupReadySweepButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={button}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          try {
            const result = await apiFetch<{ readied: number; notified: number }>("/api/admin/pickup/ready", { body: {} });
            setMessage(result.ok ? `${result.body.readied} package(s) now ready, ${result.body.notified} notification(s) sent.` : result.error);
            if (result.ok) router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        Send ready notifications
      </button>
      {message && <span className="text-xs text-muted" data-testid="pickup-ready-message">{message}</span>}
    </span>
  );
}

export function PickedUpStampButton({ packageId, version }: { packageId: string; version: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-brand-soft disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          try {
            const result = await apiFetch(`/api/admin/packages/${packageId}/stage`, {
              body: { to: "PICKED_UP", version },
            });
            if (result.ok) router.refresh();
            else setMessage(result.error);
          } finally {
            setBusy(false);
          }
        }}
      >
        Stamp picked up
      </button>
      {message && <span className="text-xs text-muted">{message}</span>}
    </span>
  );
}
