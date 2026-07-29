"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FulfillmentChoice } from "@prisma/client";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

// UR-002/G-005: shipping <-> delivery, charge preserved. Switching TO
// delivery with a purchased label requires the confirm (the label voids
// through the P8 path); the API enforces it — the dialog is the manager's
// explicit yes.
export function PackageMethodSwitch({
  packageId,
  channel,
  deliveryDays,
  currentDeliveryDay,
}: {
  packageId: string;
  channel: FulfillmentChoice;
  deliveryDays: string[];
  currentDeliveryDay: string | null;
}) {
  const router = useRouter();
  const [deliveryDay, setDeliveryDay] = useState(currentDeliveryDay ?? deliveryDays[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const to: FulfillmentChoice = channel === "SHIPPED" ? "PER_PACKAGE_DELIVERY" : "SHIPPED";

  async function run() {
    setError(null);
    setNote(null);
    const switchingToDelivery = to === "PER_PACKAGE_DELIVERY";
    if (switchingToDelivery && !deliveryDays.includes(deliveryDay)) {
      setError("Pick a delivery day first");
      return;
    }
    const confirmed = window.confirm(
      switchingToDelivery
        ? "Switch this package to local delivery? A purchased label (if any) will be voided. The charge is preserved."
        : "Switch this package back to carrier shipping? The charge is preserved.",
    );
    if (!confirmed) return;
    setBusy(true);
    const attempt = (confirmVoid: boolean) =>
      apiFetch<{ voidedShipmentId?: string | null; preservedFeeCents?: number }>(`/api/admin/packages/${packageId}/switch`, {
        method: "POST",
        body: { to, ...(switchingToDelivery ? { deliveryDay } : {}), confirmVoid },
      });
    let result = await attempt(false);
    // The 422 confirm-void demand comes back as a plain error message; one
    // explicit second confirm upgrades the call rather than making the
    // manager resubmit the form.
    if (!result.ok && switchingToDelivery && result.body.error?.includes("confirmVoid")) {
      const voidConfirmed = window.confirm("This package has a purchased label — switching voids it. Continue?");
      if (voidConfirmed) result = await attempt(true);
    }
    setBusy(false);
    if (!result.ok) {
      setError(result.body.error ?? "Switch failed");
      return;
    }
    setNote(
      `Switched to ${to === "SHIPPED" ? "carrier shipping" : "local delivery"} — charge of $${((result.body.preservedFeeCents ?? 0) / 100).toFixed(2)} preserved${result.body.voidedShipmentId ? ", label voided" : ""}.`,
    );
    router.refresh();
  }

  return (
    <Card className="mt-6 p-5" data-method-switch>
      <CardTitle>Switch fulfillment method</CardTitle>
      <p className="mt-2 text-sm text-stone-600">
        {channel === "SHIPPED"
          ? "Move this package onto a local delivery route. The paid charge is preserved; a purchased-but-unshipped label voids first."
          : "Send this package by carrier instead. The paid charge is preserved."}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {to === "PER_PACKAGE_DELIVERY" && (
          <div>
            <Label htmlFor="switch-day">Delivery day</Label>
            <Select id="switch-day" value={deliveryDay} onChange={(event) => setDeliveryDay(event.target.value)} data-switch-day>
              {deliveryDays.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </Select>
          </div>
        )}
        <Button variant="secondary" onClick={run} disabled={busy} data-switch-submit>
          {busy ? "Switching…" : to === "PER_PACKAGE_DELIVERY" ? "Switch to local delivery" : "Switch to carrier shipping"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700" data-switch-error>{error}</p>}
      {note && <p className="mt-2 text-sm text-green-800" data-switch-note>{note}</p>}
    </Card>
  );
}
