"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { formatCents } from "@/lib/catalog";

// Label controls for one shipping package (R-055), shared by the package board
// and the order detail page: buy via the margin engine, void while unshipped,
// refresh carrier tracking.

export type ShipmentSummary = {
  id: string;
  status: "PURCHASED" | "VOIDED" | "FAILED";
  carrier: string;
  service: string;
  trackingNumber: string | null;
  trackingStatus: string | null;
  labelUrl: string | null;
  costCents: number;
  chargedCents: number;
  marginCents: number;
};

export function ShipmentActions({
  packageId,
  shipment,
  shipped,
}: {
  packageId: string;
  /** Latest shipment for the package, if any. */
  shipment: ShipmentSummary | null;
  /** True once the package reached a terminal stage — labels are frozen. */
  shipped: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function act(path: string, note: string) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiFetch(path, { body: {} });
      setMessage(result.ok ? note : result.error ?? "Something went wrong");
      if (result.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const active = shipment?.status === "PURCHASED" ? shipment : null;
  const button = "rounded-md border border-border px-2 py-0.5 text-xs hover:bg-brand-soft disabled:opacity-50";

  return (
    <div className="text-xs" data-testid="shipment-actions">
      {active && (
        <p className="mb-1">
          <span className="font-medium">{active.carrier}</span> {active.service} · {active.trackingNumber}
          {active.trackingStatus && <span className="text-muted"> · {active.trackingStatus}</span>}
          <span className="block text-muted">
            paid {formatCents(active.costCents)} · charged {formatCents(active.chargedCents)} · margin{" "}
            {formatCents(active.marginCents)}
          </span>
        </p>
      )}
      {shipment?.status === "FAILED" && (
        <p className="mb-1 text-danger">Last label purchase failed — retry when ready.</p>
      )}
      {shipment?.status === "VOIDED" && !active && <p className="mb-1 text-muted">Label voided.</p>}
      <div className="flex flex-wrap gap-1">
        {!active && !shipped && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(`/api/admin/packages/${packageId}/label`, "Label purchased.")}
            className={button}
          >
            Buy label
          </button>
        )}
        {active && (
          <>
            {active.labelUrl && (
              <a href={active.labelUrl} target="_blank" rel="noreferrer" className={button}>
                Label PDF
              </a>
            )}
            {!shipped && (
              <button
                type="button"
                disabled={busy}
                onClick={() => act(`/api/admin/shipments/${active.id}/void`, "Label voided.")}
                className={button}
              >
                Void label
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => act(`/api/admin/shipments/${active.id}/tracking`, "Tracking refreshed.")}
              className={button}
            >
              Refresh tracking
            </button>
          </>
        )}
      </div>
      {message && <p className="mt-1 text-muted" data-testid="shipment-message">{message}</p>}
    </div>
  );
}
