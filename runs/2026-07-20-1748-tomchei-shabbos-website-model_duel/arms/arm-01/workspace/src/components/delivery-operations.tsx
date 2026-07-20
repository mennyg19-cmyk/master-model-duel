"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Choice = { id: string; label: string };
type PackageChoice = Choice & {
  methodId: string;
  method: string;
  stage: string;
};

export function DeliveryOperations({
  deliveryPackages,
  shippingPackages,
  pickupPackages,
  drivers,
  deliveryMethods,
  shippingMethods,
  pickupLocations,
  routes,
}: {
  deliveryPackages: PackageChoice[];
  shippingPackages: PackageChoice[];
  pickupPackages: PackageChoice[];
  drivers: Choice[];
  deliveryMethods: Choice[];
  shippingMethods: Choice[];
  pickupLocations: Choice[];
  routes: Choice[];
}) {
  const router = useRouter();
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [magicLink, setMagicLink] = useState("");
  const [suggestions, setSuggestions] = useState<PackageChoice[]>([]);
  const [suggestionRouteId, setSuggestionRouteId] = useState("");

  async function post(body: unknown) {
    const response = await fetch("/api/admin/delivery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      token?: string;
    };
    if (!response.ok) throw new Error(payload.error ?? "Delivery action failed.");
    router.refresh();
    return payload;
  }

  async function run(body: unknown, success: string) {
    try {
      await post(body);
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delivery action failed.");
    }
  }

  async function createRoute(formData: FormData) {
    try {
      const payload = await post({
        action: "create-route",
        name: formData.get("name"),
        assignedDriverId: formData.get("driverId") || undefined,
        pin: formData.get("pin") || undefined,
        packageIds: selectedPackages,
      });
      setMagicLink(`${window.location.origin}/driver/routes/${payload.token}`);
      setMessage("Route created. Copy the driver link now; only its hash is stored.");
      setSelectedPackages([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Route creation failed.");
    }
  }

  async function loadSuggestions(routeId: string) {
    const response = await fetch(`/api/admin/delivery?routeId=${encodeURIComponent(routeId)}`);
    const payload = (await response.json()) as {
      error?: string;
      suggestions?: Array<{ id: string; recipientName: string; stage: string; fulfillmentMethodId: string }>;
    };
    if (!response.ok) {
      setMessage(payload.error ?? "Nearby lookup failed.");
      return;
    }
    setSuggestions(
      (payload.suggestions ?? []).map((entry) => ({
        id: entry.id,
        label: entry.recipientName,
        stage: entry.stage,
        method: "Shipping",
        methodId: entry.fulfillmentMethodId,
      })),
    );
    setSuggestionRouteId(routeId);
    setMessage("Nearby shipping packages loaded. Nothing moves until Confirm reroute.");
  }

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-black">Build a route</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {deliveryPackages.map((entry) => (
            <label className="flex gap-3 rounded-xl border border-[var(--border)] p-3" key={entry.id}>
              <input
                checked={selectedPackages.includes(entry.id)}
                onChange={(event) =>
                  setSelectedPackages((current) =>
                    event.target.checked
                      ? [...current, entry.id]
                      : current.filter((id) => id !== entry.id),
                  )
                }
                type="checkbox"
              />
              <span><b>{entry.label}</b><br /><small>{entry.stage}</small></span>
            </label>
          ))}
        </div>
        <form action={createRoute} className="mt-4 grid gap-3 md:grid-cols-4">
          <input className="rounded-xl border p-3" name="name" placeholder="Route name" required />
          <select className="rounded-xl border p-3" name="driverId">
            <option value="">Unassigned driver</option>
            {drivers.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <input className="rounded-xl border p-3" inputMode="numeric" maxLength={4} name="pin" placeholder="Optional 4-digit PIN" />
          <button className="rounded-xl bg-[var(--brand)] px-4 py-3 font-bold text-white">Create route</button>
        </form>
        {magicLink && <input className="mt-4 w-full rounded-xl border p-3" readOnly value={magicLink} />}
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-black">Route assignment and reroute map</h2>
        <div className="mt-4 grid gap-4">
          {routes.map((route) => (
            <div className="grid gap-3 rounded-xl border p-4 md:grid-cols-[1fr_1fr_auto_auto]" key={route.id}>
              <a className="font-bold text-[var(--brand-dark)]" href={`/admin/delivery/routes/${route.id}`}>{route.label}</a>
              <select
                className="rounded-lg border p-2"
                defaultValue=""
                onChange={(event) => void run({
                  action: "reassign-route",
                  routeId: route.id,
                  assignedDriverId: event.target.value || null,
                }, "Route reassigned.")}
              >
                <option value="">Reassign driver</option>
                {drivers.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
              <button className="rounded-lg border px-3 py-2 font-bold" onClick={() => void loadSuggestions(route.id)} type="button">Find nearby</button>
              <a className="rounded-lg border px-3 py-2 text-center font-bold" href={`/admin/delivery/routes/${route.id}?print=1`}>Print</a>
            </div>
          ))}
        </div>
        {suggestions.map((entry) => (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--surface)] p-3" key={entry.id}>
            <span>{entry.label} · {entry.stage}</span>
            <button
              className="rounded-lg bg-[var(--ink)] px-3 py-2 font-bold text-white"
              onClick={() => {
                const deliveryMethodId = deliveryMethods[0]?.id;
                if (suggestionRouteId && deliveryMethodId) {
                  void run({ action: "confirm-reroute", routeId: suggestionRouteId, packageId: entry.id, deliveryMethodId }, "Label voided and package added; print revision updated.");
                }
              }}
              type="button"
            >
              Confirm reroute
            </button>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-xl font-black">Method switch and bulk schedule</h2>
          {[...shippingPackages, ...deliveryPackages].map((entry) => {
            const target = entry.method === "Shipping" ? deliveryMethods[0] : shippingMethods[0];
            return (
              <div className="mt-3 rounded-xl border p-3" key={entry.id}>
                <p className="font-bold">{entry.label} · {entry.method}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {target && <button className="rounded-lg border px-3 py-2 text-sm font-bold" onClick={() => void run({ action: "switch-method", packageId: entry.id, fulfillmentMethodId: target.id }, "Method switched; paid balance preserved.")} type="button">Switch to {target.label}</button>}
                  <button className="rounded-lg border px-3 py-2 text-sm font-bold" onClick={() => void run({ action: "schedule-bulk", packageId: entry.id, start: new Date(Date.now() + 86_400_000), end: new Date(Date.now() + 90_000_000) }, "Bulk delivery scheduled; email and SMS captured.")} type="button">Schedule tomorrow</button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-xl font-black">Pickup door list</h2>
          {pickupPackages.map((entry) => (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3" key={entry.id}>
              <span className="font-bold">{entry.label} · {entry.stage}</span>
              <div className="flex gap-2">
                {pickupLocations[0] && <button className="rounded-lg border px-3 py-2 text-sm font-bold" onClick={() => void run({ action: "pickup-ready", packageId: entry.id, pickupLocationId: pickupLocations[0]!.id }, "Pickup ready notification captured once.")} type="button">Mark ready</button>}
                <button className="rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-bold text-white" onClick={() => void run({ action: "pickup-stamp", packageId: entry.id }, "Pickup stamped.")} type="button">Picked up</button>
              </div>
            </div>
          ))}
        </div>
      </section>
      {message && <p aria-live="polite" className="sticky bottom-4 rounded-xl bg-[var(--ink)] p-4 font-semibold text-white">{message}</p>}
    </div>
  );
}
