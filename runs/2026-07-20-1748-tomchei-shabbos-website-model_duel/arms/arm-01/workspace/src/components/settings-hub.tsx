"use client";

import type { SeasonStatus } from "@prisma/client";
import { useState } from "react";

type SettingsTab = "Orders" | "Shipping" | "Email" | "Developer";

export function SettingsHub({
  season,
  initialDeliveryZips,
  packageTypes,
  pickupLocations,
}: {
  season: { id: string; name: string; status: SeasonStatus } | null;
  initialDeliveryZips: string[];
  packageTypes: { id: string; name: string }[];
  pickupLocations: { id: string; name: string; isActive: boolean }[];
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("Orders");
  const [storeStatus, setStoreStatus] = useState<SeasonStatus>(season?.status ?? "CLOSED");
  const [deliveryZips, setDeliveryZips] = useState(initialDeliveryZips.join(", "));
  const [message, setMessage] = useState("");
  const tabs: SettingsTab[] = ["Orders", "Shipping", "Email", "Developer"];

  async function saveSettings(changes: {
    storeStatus?: SeasonStatus;
    deliveryZips?: string[];
  }) {
    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seasonId: season?.id, ...changes }),
    });
    const payload = await response.json();
    setMessage(response.ok ? "Settings saved. Storefront checks now use these values." : payload.error);
  }

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
        Configuration
      </p>
      <h1 className="mt-2 text-4xl font-black">Settings</h1>
      <div className="mt-8 flex gap-2 overflow-x-auto border-b border-[var(--border)]">
        {tabs.map((tab) => (
          <button
            className={`border-b-2 px-4 py-3 font-bold ${activeTab === tab ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)]"}`}
            key={tab}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="mt-6 rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8">
        {activeTab === "Orders" && (
          <div className="space-y-8">
            <section>
              <h2 className="text-xl font-bold">Store status</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{season?.name ?? "No season configured"}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {(["OPEN", "CLOSED"] as const).map((status) => (
                  <button
                    className={`rounded-full px-5 py-2.5 font-bold ${storeStatus === status ? "bg-[var(--ink)] text-white" : "bg-[var(--surface)]"}`}
                    key={status}
                    onClick={() => {
                      setStoreStatus(status);
                      saveSettings({ storeStatus: status });
                    }}
                    type="button"
                  >
                    {status === "OPEN" ? "Open for orders" : "Closed"}
                  </button>
                ))}
              </div>
            </section>
            <section>
              <h2 className="text-xl font-bold">Package types</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {packageTypes.map((packageType) => (
                  <span className="rounded-full bg-[var(--surface)] px-4 py-2 text-sm font-semibold" key={packageType.id}>
                    {packageType.name}
                  </span>
                ))}
                {packageTypes.length === 0 && <p className="text-sm text-[var(--muted)]">No package types yet.</p>}
              </div>
            </section>
            <section>
              <h2 className="text-xl font-bold">Pickup locations</h2>
              <div className="mt-3 space-y-2">
                {pickupLocations.map((location) => (
                  <div className="flex justify-between rounded-2xl bg-[var(--surface)] px-4 py-3" key={location.id}>
                    <span className="font-semibold">{location.name}</span>
                    <span className="text-sm text-[var(--muted)]">{location.isActive ? "Active" : "Hidden"}</span>
                  </div>
                ))}
                {pickupLocations.length === 0 && <p className="text-sm text-[var(--muted)]">No pickup locations yet.</p>}
              </div>
            </section>
          </div>
        )}
        {activeTab === "Shipping" && (
          <div className="space-y-8">
            <section>
              <h2 className="text-xl font-bold">Local delivery ZIPs</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Comma-separated. Order eligibility reads this list on every request.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  className="min-w-0 flex-1 rounded-xl border border-[var(--border)] px-4 py-3"
                  onChange={(event) => setDeliveryZips(event.target.value)}
                  value={deliveryZips}
                />
                <button
                  className="rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white"
                  onClick={() =>
                    saveSettings({
                      deliveryZips: deliveryZips.split(",").map((postalCode) => postalCode.trim()).filter(Boolean),
                    })
                  }
                  type="button"
                >
                  Save ZIPs
                </button>
              </div>
            </section>
            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-[var(--surface)] p-5">
                <h3 className="font-bold">Rates</h3>
                <p className="mt-2 text-sm text-[var(--muted)]">Rate rules are ready for live carrier pricing in P8.</p>
              </div>
              <div className="rounded-2xl bg-[var(--surface)] p-5">
                <h3 className="font-bold">Delivery rules</h3>
                <p className="mt-2 text-sm text-[var(--muted)]">ZIP eligibility is active. Fee rules arrive with checkout.</p>
              </div>
            </section>
          </div>
        )}
        {activeTab === "Email" && (
          <div>
            <h2 className="text-xl font-bold">Email defaults</h2>
            <p className="mt-2 max-w-xl text-[var(--muted)]">
              Newsletter preferences are active. Campaign templates, sender setup,
              and transactional overrides arrive with the notification platform.
            </p>
          </div>
        )}
        {activeTab === "Developer" && (
          <div>
            <h2 className="text-xl font-bold">Provider status</h2>
            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-[var(--surface)] p-5">
                <dt className="text-sm text-[var(--muted)]">Media</dt>
                <dd className="mt-1 font-bold">Vercel Blob adapter</dd>
              </div>
              <div className="rounded-2xl bg-[var(--surface)] p-5">
                <dt className="text-sm text-[var(--muted)]">Newsletter links</dt>
                <dd className="mt-1 font-bold">HMAC signed · 30 days</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
      {message && (
        <p aria-live="polite" className="mt-4 rounded-xl bg-[var(--brand-soft)] px-4 py-3 text-sm font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
