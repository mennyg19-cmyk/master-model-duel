"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { STORE_SETTINGS } from "@/lib/storefront/settings-keys";

type Tab = "orders" | "shipping" | "email" | "developer";

export function SettingsHub() {
  const [tab, setTab] = useState<Tab>("orders");
  const [zips, setZips] = useState("11218,11219,11230,11204");
  const [message, setMessage] = useState<string | null>(null);
  const [packageTypes, setPackageTypes] = useState<{ code: string; name: string }[]>([]);
  const [pickups, setPickups] = useState<{ code: string; name: string }[]>([]);
  const [checkZip, setCheckZip] = useState("11218");
  const [zipAllowed, setZipAllowed] = useState<boolean | null>(null);

  async function load() {
    const res = await fetch("/api/admin/store-settings");
    const json = await res.json();
    if (!res.ok) return;
    if (json.deliveryZips?.zips) setZips(json.deliveryZips.zips.join(","));
    setPackageTypes(json.packageTypes || []);
    setPickups(json.pickupLocations || []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveZips(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/admin/store-settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: STORE_SETTINGS.deliveryZips,
        value: { zips: zips.split(",").map((z) => z.trim()).filter(Boolean) },
      }),
    });
    const json = await res.json();
    setMessage(res.ok ? "Delivery ZIPs saved." : json.error || "Save failed");
    if (res.ok) await checkDeliveryZip(checkZip);
  }

  async function checkDeliveryZip(zip: string) {
    const res = await fetch(`/api/storefront/status?zip=${encodeURIComponent(zip)}`);
    const json = await res.json();
    setZipAllowed(json.zipAllowed);
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "orders", label: "Orders" },
    { id: "shipping", label: "Shipping" },
    { id: "email", label: "Email" },
    { id: "developer", label: "Developer" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              tab === t.id ? "bg-[var(--color-leaf)] text-white" : "bg-white"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "orders" ? (
        <section className="space-y-3 rounded bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Orders</h2>
          <p className="text-sm text-[var(--color-ink)]/70">
            Store status follows the current season Open/Closed gate. Package types and pickup locations below.
          </p>
          <div>
            <h3 className="text-sm font-semibold">Package types</h3>
            <ul className="mt-1 text-sm">
              {packageTypes.map((p) => (
                <li key={p.code}>
                  {p.code} — {p.name}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Pickup locations</h3>
            <ul className="mt-1 text-sm">
              {pickups.map((p) => (
                <li key={p.code}>
                  {p.code} — {p.name}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-sm">Follow-up: season wizard deferred to P10.</p>
        </section>
      ) : null}

      {tab === "shipping" ? (
        <section className="space-y-3 rounded bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Shipping</h2>
          <p className="text-sm text-[var(--color-ink)]/70">Rates/rules shells — live Shippo in later phases.</p>
          <form onSubmit={saveZips} className="space-y-2">
            <label className="block text-sm font-semibold">
              Delivery ZIPs (comma-separated)
              <textarea
                className="mt-1 w-full rounded border px-2 py-1.5 font-normal"
                rows={3}
                value={zips}
                onChange={(e) => setZips(e.target.value)}
                data-testid="delivery-zips"
              />
            </label>
            <Button type="submit">Save ZIPs</Button>
          </form>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Check ZIP
              <input
                className="mt-1 block rounded border px-2 py-1.5"
                value={checkZip}
                onChange={(e) => setCheckZip(e.target.value)}
              />
            </label>
            <Button type="button" variant="secondary" onClick={() => checkDeliveryZip(checkZip)}>
              Check
            </Button>
            {zipAllowed !== null ? (
              <p className="text-sm" data-testid="zip-check-result">
                {checkZip}: {zipAllowed ? "allowed" : "blocked"}
              </p>
            ) : null}
          </div>
          {message ? <p className="text-sm">{message}</p> : null}
        </section>
      ) : null}

      {tab === "email" ? (
        <section className="rounded bg-white p-4 shadow-sm text-sm">
          <h2 className="font-semibold">Email</h2>
          <p className="mt-2 text-[var(--color-ink)]/70">From / reply-to settings shell — notification platform is later.</p>
        </section>
      ) : null}

      {tab === "developer" ? (
        <section className="rounded bg-white p-4 shadow-sm text-sm">
          <h2 className="font-semibold">Developer</h2>
          <p className="mt-2 text-[var(--color-ink)]/70">Hooks for test mode and launch readiness land in P12.</p>
        </section>
      ) : null}
    </div>
  );
}
