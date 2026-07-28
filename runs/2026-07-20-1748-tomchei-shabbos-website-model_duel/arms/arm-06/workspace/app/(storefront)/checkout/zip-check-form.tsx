"use client";

import { FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Delivery-area probe (G-014): asks the server whether a ZIP is inside the
// manager's delivery allowlist. The answer is never cached client-side.
export function ZipCheckForm() {
  const [deliveryResult, setDeliveryResult] = useState<{ deliverable: boolean; postalCode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsChecking(true);
    setError(null);
    setDeliveryResult(null);

    const form = new FormData(event.currentTarget);
    const postalCode = String(form.get("postalCode") ?? "");
    const { ok, body } = await apiFetch<{ deliverable?: boolean }>("/api/delivery-check", {
      method: "POST",
      body: { postalCode },
    });
    setIsChecking(false);

    if (!ok) {
      setError(body.error ?? "Could not check that ZIP right now");
      return;
    }
    setDeliveryResult({ deliverable: Boolean(body.deliverable), postalCode });
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex max-w-md flex-col gap-3">
      <div>
        <Label htmlFor="postalCode">Delivery ZIP check</Label>
        <div className="flex gap-2">
          <Input
            id="postalCode"
            name="postalCode"
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={5}
            required
            placeholder="08701"
          />
          <Button type="submit" variant="secondary" disabled={isChecking}>
            {isChecking ? "Checking…" : "Check"}
          </Button>
        </div>
      </div>
      {deliveryResult && (
        <p className={`text-sm font-medium ${deliveryResult.deliverable ? "text-green-700" : "text-red-700"}`} role="status">
          {deliveryResult.deliverable
            ? `${deliveryResult.postalCode} is inside the delivery area.`
            : `${deliveryResult.postalCode} is outside the delivery area — pickup or shipping only.`}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
