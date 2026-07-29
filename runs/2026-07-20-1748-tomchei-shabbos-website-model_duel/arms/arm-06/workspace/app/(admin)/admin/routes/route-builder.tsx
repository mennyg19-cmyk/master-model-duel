"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

// R-075: pick a manager-set delivery day, optional name, build. The response
// carries the optimizer that ran so the UI can say "ordered by Mapbox" vs
// "ordered by nearest-neighbor".
export function RouteBuilder({ deliveryDays }: { deliveryDays: string[] }) {
  const router = useRouter();
  const [deliveryDay, setDeliveryDay] = useState(deliveryDays[0] ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function build(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiFetch<{ routeId?: string; provider?: string }>("/api/admin/routes", {
      method: "POST",
      body: { deliveryDay, ...(name.trim() ? { name: name.trim() } : {}) },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.body.error ?? "Build failed");
      return;
    }
    if (result.body.routeId) {
      router.push(`/admin/routes/${result.body.routeId}`);
      return;
    }
    router.refresh();
  }

  if (deliveryDays.length === 0) {
    return <p className="mt-3 text-sm text-stone-500">Set delivery days in Settings before building routes.</p>;
  }

  return (
    <form onSubmit={build} className="mt-3 flex flex-wrap items-end gap-3" data-route-build-form>
      <div>
        <Label htmlFor="route-day">Delivery day</Label>
        <Select id="route-day" value={deliveryDay} onChange={(event) => setDeliveryDay(event.target.value)} data-route-day>
          {deliveryDays.map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="route-name">Name (optional)</Label>
        <Input id="route-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Friday — Route 1" data-route-name />
      </div>
      <Button type="submit" disabled={busy} data-route-build>
        {busy ? "Building…" : "Build route"}
      </Button>
      {error && <p className="w-full text-sm text-red-700" data-route-build-error>{error}</p>}
    </form>
  );
}
