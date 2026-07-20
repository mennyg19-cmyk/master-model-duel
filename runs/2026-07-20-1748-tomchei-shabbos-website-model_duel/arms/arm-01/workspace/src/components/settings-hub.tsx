"use client";

import type { SeasonStatus } from "@prisma/client";
import { useState } from "react";
import type { AdminSettings } from "@/lib/store-settings";

type SettingsTab = "Orders" | "Shipping" | "Email" | "Developer";

export function SettingsHub({
  season,
  initialDeliveryZips,
  initialAdminSettings,
  packageTypes,
  pickupLocations,
  seasons,
}: {
  season: {
    id: string;
    name: string;
    status: SeasonStatus;
    scheduledStatus: SeasonStatus | null;
    scheduledStatusAt: string | null;
  } | null;
  initialDeliveryZips: string[];
  initialAdminSettings: AdminSettings;
  packageTypes: { id: string; name: string }[];
  pickupLocations: { id: string; name: string; isActive: boolean }[];
  seasons: {
    id: string;
    name: string;
    year: number;
    status: SeasonStatus;
  }[];
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("Orders");
  const [storeStatus, setStoreStatus] = useState<SeasonStatus>(season?.status ?? "CLOSED");
  const [deliveryZips, setDeliveryZips] = useState(initialDeliveryZips.join(", "));
  const [message, setMessage] = useState("");
  const [adminSettings, setAdminSettings] = useState(initialAdminSettings);
  const [emailTestRecipient, setEmailTestRecipient] = useState("");
  const [scheduledStatus, setScheduledStatus] = useState<SeasonStatus>(
    season?.scheduledStatus ?? "OPEN",
  );
  const [scheduledStatusAt, setScheduledStatusAt] = useState("");
  const tabs: SettingsTab[] = ["Orders", "Shipping", "Email", "Developer"];

  async function saveSettings(changes: {
    storeStatus?: SeasonStatus;
    scheduledStatus?: SeasonStatus;
    scheduledStatusAt?: string;
    deliveryZips?: string[];
    adminSettings?: AdminSettings;
  }) {
    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seasonId: season?.id, ...changes }),
    });
    const payload = await response.json();
    setMessage(response.ok ? "Settings saved. Storefront checks now use these values." : payload.error);
  }

  async function createSeason(formData: FormData) {
    const response = await fetch("/api/admin/seasons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        year: Number(formData.get("year")),
        sourceSeasonId: formData.get("sourceSeasonId") || undefined,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }
    setMessage(`${payload.season.name} was created as the closed current season.`);
    window.location.reload();
  }

  async function sendEmailTest() {
    const response = await fetch("/api/admin/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "testTransactional",
        recipient: emailTestRecipient,
        templateKey: "order.confirmation",
      }),
    });
    const payload = await response.json();
    setMessage(response.ok ? "Email test queued." : payload.error);
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
              <div className="mt-5 grid gap-3 rounded-2xl bg-[var(--surface)] p-4 sm:grid-cols-[160px_1fr_auto]">
                <select
                  className="rounded-xl border border-[var(--border)] px-3 py-2.5"
                  onChange={(event) => setScheduledStatus(event.target.value as SeasonStatus)}
                  value={scheduledStatus}
                >
                  <option value="OPEN">Open automatically</option>
                  <option value="CLOSED">Close automatically</option>
                </select>
                <input
                  aria-label="Scheduled season status time"
                  className="rounded-xl border border-[var(--border)] px-3 py-2.5"
                  onChange={(event) => setScheduledStatusAt(event.target.value)}
                  type="datetime-local"
                  value={scheduledStatusAt}
                />
                <button
                  className="rounded-xl bg-[var(--ink)] px-4 py-2.5 font-bold text-white"
                  onClick={() => {
                    if (!scheduledStatusAt) {
                      setMessage("Choose a date and time for the automatic status change.");
                      return;
                    }
                    void saveSettings({
                      scheduledStatus,
                      scheduledStatusAt: new Date(scheduledStatusAt).toISOString(),
                    });
                  }}
                  type="button"
                >
                  Schedule
                </button>
              </div>
              {season?.scheduledStatusAt && (
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Scheduled to {season.scheduledStatus?.toLowerCase()} on{" "}
                  {new Date(season.scheduledStatusAt).toLocaleString()}.
                </p>
              )}
            </section>
            <section>
              <h2 className="text-xl font-bold">New-season setup wizard</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Clone catalog and operating settings, start with zero stock, and
                create forward replacement mappings from the prior catalog.
              </p>
              <form action={createSeason} className="mt-4 grid gap-3 sm:grid-cols-3">
                <input
                  className="rounded-xl border border-[var(--border)] px-3 py-2.5"
                  name="name"
                  placeholder="Purim 2028"
                  required
                />
                <input
                  className="rounded-xl border border-[var(--border)] px-3 py-2.5"
                  min="2000"
                  name="year"
                  placeholder="2028"
                  required
                  type="number"
                />
                <select
                  className="rounded-xl border border-[var(--border)] px-3 py-2.5"
                  defaultValue={season?.id ?? ""}
                  name="sourceSeasonId"
                >
                  <option value="">Start empty</option>
                  {seasons.map((seasonChoice) => (
                    <option key={seasonChoice.id} value={seasonChoice.id}>
                      Clone {seasonChoice.name} ({seasonChoice.status.toLowerCase()})
                    </option>
                  ))}
                </select>
                <button
                  className="rounded-xl bg-[var(--brand)] px-5 py-3 font-bold text-white sm:col-span-3"
                  type="submit"
                >
                  Create closed season
                </button>
              </form>
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
            <section className="grid gap-4 sm:grid-cols-2">
              <label className="font-bold">Follow-up after days
                <input className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2" max="30" min="0" onChange={(event) => setAdminSettings({ ...adminSettings, followUpDays: Number(event.target.value) })} type="number" value={adminSettings.followUpDays} />
              </label>
              <label className="font-bold">Operations alert
                <input className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2" onChange={(event) => setAdminSettings({ ...adminSettings, operationsAlert: event.target.value })} value={adminSettings.operationsAlert} />
              </label>
              <button className="rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white sm:col-span-2" onClick={() => saveSettings({ adminSettings })} type="button">Save order operations</button>
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
          <div className="space-y-4">
            <h2 className="text-xl font-bold">Email defaults</h2>
            <label className="block max-w-xl font-bold">Sender name
              <input className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2" onChange={(event) => setAdminSettings({ ...adminSettings, emailSenderName: event.target.value })} value={adminSettings.emailSenderName} />
            </label>
            <button className="rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white" onClick={() => saveSettings({ adminSettings })} type="button">Save email defaults</button>
            <div className="max-w-xl border-t border-[var(--border)] pt-5">
              <h3 className="font-bold">Send test email</h3>
              <div className="mt-3 flex gap-3">
                <input
                  className="min-w-0 flex-1 rounded-xl border border-[var(--border)] px-3 py-2"
                  onChange={(event) => setEmailTestRecipient(event.target.value)}
                  placeholder="staff@example.org"
                  type="email"
                  value={emailTestRecipient}
                />
                <button className="rounded-xl bg-[var(--brand)] px-5 py-2 font-bold text-white" onClick={sendEmailTest} type="button">Send test</button>
              </div>
            </div>
          </div>
        )}
        {activeTab === "Developer" && (
          <div className="space-y-5">
            <h2 className="text-xl font-bold">Provider status</h2>
            <label className="block max-w-xl font-bold">Webhook label
              <input className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2" onChange={(event) => setAdminSettings({ ...adminSettings, developerWebhookLabel: event.target.value })} value={adminSettings.developerWebhookLabel} />
            </label>
            <button className="rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white" onClick={() => saveSettings({ adminSettings })} type="button">Save developer config</button>
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
