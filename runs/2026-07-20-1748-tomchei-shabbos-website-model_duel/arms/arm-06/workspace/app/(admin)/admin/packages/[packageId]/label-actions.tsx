"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

export interface ShipmentRow {
  id: string;
  status: string;
  carrier: string | null;
  serviceLevel: string | null;
  trackingNumber: string | null;
  trackingStatus: string | null;
  labelUrl: string | null;
  chargedCents: number;
  costCents: number | null;
  marginCents: number | null;
  error: string | null;
}

// R-055/R-175/R-176/R-177: the SHIPPED package's label card — buy (address
// validation runs first carrier-side), void while unshipped, tracking
// refresh, and the honest margin ledger (charged / cost / margin). Failed
// attempts stay visible so staff fix the cause instead of guessing.
export function PackageLabelActions({
  packageId,
  isTerminal,
  shipments,
}: {
  packageId: string;
  isTerminal: boolean;
  shipments: ShipmentRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const active = shipments.find((shipment) => shipment.status === "PURCHASING" || shipment.status === "PURCHASED") ?? null;
  const lastFailed = shipments.find((shipment) => shipment.status === "FAILED") ?? null;

  async function run(label: string, path: string, body?: Record<string, unknown>) {
    setBusy(label);
    setError(null);
    setNote(null);
    const result = await apiFetch<{
      error?: string;
      validation?: { isValid: boolean; messages: string[] };
      shipment?: { trackingStatus?: string | null };
    }>(path, body ? { method: "POST", body } : { method: "POST" });
    setBusy(null);
    if (!result.ok) {
      setError(result.body.error ?? "Action failed");
      return;
    }
    if (label === "validate") {
      const validation = result.body.validation!;
      setNote(
        validation.isValid
          ? "Carrier validated the address."
          : `Address failed validation: ${validation.messages.join("; ") || "no detail from the carrier"}`,
      );
      return;
    }
    if (label === "track") {
      setNote(`Tracking: ${result.body.shipment?.trackingStatus ?? "UNKNOWN"}`);
    }
    router.refresh();
  }

  return (
    <Card className="mt-6 p-5" data-label-card>
      <CardTitle>Carrier label</CardTitle>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert" data-label-error>
          {error}
        </p>
      )}
      {note && (
        <p className="mt-2 text-sm text-green-800" data-label-note>
          {note}
        </p>
      )}

      {active ? (
        <div className="mt-3 text-sm" data-active-shipment>
          <p className="text-stone-700">
            {active.carrier} · {active.serviceLevel}
            {active.trackingNumber && (
              <>
                {" · tracking "}
                <span className="font-mono" data-tracking-number>
                  {active.trackingNumber}
                </span>
              </>
            )}
            {active.trackingStatus && <> · {active.trackingStatus}</>}
          </p>
          <p className="mt-1 text-stone-600" data-margin-ledger>
            Charged {formatCents(active.chargedCents)}
            {active.costCents !== null && <> · label cost {formatCents(active.costCents)}</>}
            {active.marginCents !== null && <> · margin {formatCents(active.marginCents)}</>}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {active.labelUrl && (
              <a
                href={active.labelUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-brand-700 hover:underline"
                data-label-url
              >
                Label PDF
              </a>
            )}
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run("track", `/api/admin/packages/${packageId}/label/track`)} data-tracking-refresh>
              {busy === "track" ? "Refreshing…" : "Refresh tracking"}
            </Button>
            {!isTerminal && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => {
                  if (window.confirm("Void this label? The shipment cost is refunded carrier-side.")) {
                    void run("void", `/api/admin/packages/${packageId}/label/void`, {});
                  }
                }}
                data-label-void
              >
                {busy === "void" ? "Voiding…" : "Void label"}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!isTerminal && (
            <>
              <Button size="sm" disabled={busy !== null} onClick={() => run("buy", `/api/admin/packages/${packageId}/label`)} data-label-buy>
                {busy === "buy" ? "Buying…" : "Buy label"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => run("validate", `/api/admin/packages/${packageId}/label/validate`)}
                data-address-validate
              >
                {busy === "validate" ? "Checking…" : "Validate address"}
              </Button>
            </>
          )}
          {isTerminal && <p className="text-sm text-stone-500">Package is with the carrier — label actions are closed.</p>}
        </div>
      )}

      {lastFailed && !active && (
        <p className="mt-3 text-sm text-amber-800" data-label-failed>
          Last attempt failed: {lastFailed.error}
        </p>
      )}
      {shipments.some((shipment) => shipment.status === "VOIDED") && !active && (
        <p className="mt-1 text-xs text-stone-500">A previous label was voided — buying again re-quotes live.</p>
      )}
    </Card>
  );
}
