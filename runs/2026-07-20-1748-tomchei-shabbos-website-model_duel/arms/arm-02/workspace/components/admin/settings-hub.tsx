"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";

type SeasonRow = { id: string; name: string; status: "OPEN" | "CLOSED" };
type PackageTypeRow = { id: string; name: string; widthCm: number | null; lengthCm: number | null; heightCm: number | null; weightGrams: number | null };
type PickupLocationRow = { id: string; name: string; line1: string; city: string; state: string; zip: string; isActive: boolean };
type ShippingRate = { name: string; amountCents: number };
type ShippingRules = { bulkFeePerDestinationCents: number; perPackageFeeCents: number };

export type SettingsHubData = {
  seasons: SeasonRow[];
  packageTypes: PackageTypeRow[];
  pickupLocations: PickupLocationRow[];
  followupDays: number;
  closedMessage: string;
  deliveryZips: string[];
  shippingRates: ShippingRate[];
  shippingRules: ShippingRules;
  emailFrom: string;
  emailReplyTo: string;
};

const TABS = ["Orders", "Shipping", "Email", "Developer"] as const;
type Tab = (typeof TABS)[number];

async function requestJson(url: string, method: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => ({}));
  return { ok: response.ok, error: parsed.error };
}

export function SettingsHub({ data }: { data: SettingsHubData }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Orders");
  const [message, setMessage] = useState<string | null>(null);

  async function act(action: () => Promise<{ ok: boolean; error?: string }>, successMessage = "Saved.") {
    setMessage(null);
    const outcome = await action();
    setMessage(outcome.ok ? successMessage : outcome.error ?? "Request failed.");
    if (outcome.ok) router.refresh();
  }

  const saveSetting = (key: string, value: unknown, successMessage?: string) =>
    act(() => requestJson("/api/admin/settings", "PATCH", { key, value }), successMessage);

  return (
    <div className="space-y-5">
      <div role="tablist" className="flex gap-1 border-b border-border">
        {TABS.map((tabName) => (
          <button
            key={tabName}
            role="tab"
            aria-selected={tab === tabName}
            onClick={() => setTab(tabName)}
            className={`rounded-t-md px-4 py-2 text-sm font-medium ${
              tab === tabName ? "border border-b-0 border-border bg-surface text-brand-strong" : "text-muted hover:text-foreground"
            }`}
          >
            {tabName}
          </button>
        ))}
      </div>

      {message && <p className="rounded bg-brand-soft px-3 py-2 text-sm">{message}</p>}

      {tab === "Orders" && (
        <OrdersTab
          seasons={data.seasons}
          packageTypes={data.packageTypes}
          pickupLocations={data.pickupLocations}
          followupDays={data.followupDays}
          closedMessage={data.closedMessage}
          act={act}
          saveSetting={saveSetting}
        />
      )}
      {tab === "Shipping" && (
        <ShippingTab
          deliveryZips={data.deliveryZips}
          shippingRates={data.shippingRates}
          shippingRules={data.shippingRules}
          saveSetting={saveSetting}
        />
      )}
      {tab === "Email" && <EmailTab emailFrom={data.emailFrom} emailReplyTo={data.emailReplyTo} saveSetting={saveSetting} />}
      {tab === "Developer" && <DeveloperTab />}
    </div>
  );
}

type ActFn = (action: () => Promise<{ ok: boolean; error?: string }>, successMessage?: string) => Promise<void>;
type SaveSettingFn = (key: string, value: unknown, successMessage?: string) => Promise<void>;

function OrdersTab({
  seasons,
  packageTypes,
  pickupLocations,
  followupDays,
  closedMessage,
  act,
  saveSetting,
}: {
  seasons: SeasonRow[];
  packageTypes: PackageTypeRow[];
  pickupLocations: PickupLocationRow[];
  followupDays: number;
  closedMessage: string;
  act: ActFn;
  saveSetting: SaveSettingFn;
}) {
  const [newPackageType, setNewPackageType] = useState("");
  const [newLocation, setNewLocation] = useState({ name: "", line1: "", city: "", state: "", zip: "" });
  const [followup, setFollowup] = useState(String(followupDays));
  const [closed, setClosed] = useState(closedMessage);

  async function addPackageType(event: FormEvent) {
    event.preventDefault();
    await act(() => requestJson("/api/admin/package-types", "POST", { name: newPackageType }));
    setNewPackageType("");
  }

  async function addLocation(event: FormEvent) {
    event.preventDefault();
    await act(() => requestJson("/api/admin/pickup-locations", "POST", newLocation));
    setNewLocation({ name: "", line1: "", city: "", state: "", zip: "" });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardTitle>Store status</CardTitle>
        <p className="mb-3 text-sm text-muted">
          The storefront sells from the open season. Closing it hides checkout everywhere on the next request.
        </p>
        <ul className="space-y-2 text-sm">
          {seasons.map((season) => (
            <li key={season.id} className="flex items-center gap-3">
              <span className="font-medium">{season.name}</span>
              <Badge tone={season.status === "OPEN" ? "success" : "neutral"}>{season.status}</Badge>
              <Button
                variant="secondary"
                className="ml-auto"
                onClick={() =>
                  act(
                    () =>
                      requestJson("/api/admin/season-status", "PATCH", {
                        seasonId: season.id,
                        status: season.status === "OPEN" ? "CLOSED" : "OPEN",
                      }),
                    `${season.name} is now ${season.status === "OPEN" ? "closed" : "open"}.`
                  )
                }
              >
                {season.status === "OPEN" ? "Close store" : "Open store"}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-border pt-3">
          <label htmlFor="closed-message" className="text-sm font-medium">Storewide closed banner</label>
          <div className="mt-1 flex gap-2">
            <Input id="closed-message" value={closed} onChange={(event) => setClosed(event.target.value)} className="flex-1" />
            <Button onClick={() => saveSetting("store.closed_message", closed)}>Save</Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Package types</CardTitle>
        <ul className="space-y-1 text-sm">
          {packageTypes.map((packageType) => (
            <li key={packageType.id} className="flex items-center gap-3">
              {packageType.name}
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => act(() => requestJson(`/api/admin/package-types/${packageType.id}`, "DELETE", {}), "Package type removed.")}
              >
                Remove
              </Button>
            </li>
          ))}
          {packageTypes.length === 0 && <li className="text-muted">None yet.</li>}
        </ul>
        <form onSubmit={addPackageType} className="mt-3 flex gap-2">
          <Input required value={newPackageType} onChange={(event) => setNewPackageType(event.target.value)} placeholder="Small gift box" className="flex-1" />
          <Button type="submit">Add</Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Pickup locations</CardTitle>
        <ul className="space-y-1 text-sm">
          {pickupLocations.map((location) => (
            <li key={location.id} className="flex items-center gap-3">
              <span>
                {location.name} — {location.line1}, {location.city} {location.zip}
              </span>
              <Badge tone={location.isActive ? "success" : "neutral"}>{location.isActive ? "Active" : "Inactive"}</Badge>
              <Button
                variant="secondary"
                className="ml-auto"
                onClick={() =>
                  act(() => requestJson(`/api/admin/pickup-locations/${location.id}`, "PATCH", { isActive: !location.isActive }))
                }
              >
                {location.isActive ? "Deactivate" : "Activate"}
              </Button>
            </li>
          ))}
          {pickupLocations.length === 0 && <li className="text-muted">None yet.</li>}
        </ul>
        <form onSubmit={addLocation} className="mt-3 flex flex-wrap gap-2">
          <Input required placeholder="Name" value={newLocation.name} onChange={(event) => setNewLocation({ ...newLocation, name: event.target.value })} />
          <Input required placeholder="Street" value={newLocation.line1} onChange={(event) => setNewLocation({ ...newLocation, line1: event.target.value })} />
          <Input required placeholder="City" value={newLocation.city} onChange={(event) => setNewLocation({ ...newLocation, city: event.target.value })} className="w-28" />
          <Input required placeholder="ST" maxLength={2} value={newLocation.state} onChange={(event) => setNewLocation({ ...newLocation, state: event.target.value.toUpperCase() })} className="w-14" />
          <Input required placeholder="ZIP" maxLength={5} value={newLocation.zip} onChange={(event) => setNewLocation({ ...newLocation, zip: event.target.value })} className="w-20" />
          <Button type="submit">Add</Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Follow-up</CardTitle>
        <label htmlFor="followup-days" className="text-sm">Days after delivery before the follow-up email</label>
        <div className="mt-1 flex gap-2">
          <Input id="followup-days" type="number" min="0" value={followup} onChange={(event) => setFollowup(event.target.value)} className="w-24" />
          <Button onClick={() => saveSetting("orders.followup_days", Number(followup))}>Save</Button>
        </div>
      </Card>
    </div>
  );
}

function ShippingTab({
  deliveryZips,
  shippingRates,
  shippingRules,
  saveSetting,
}: {
  deliveryZips: string[];
  shippingRates: ShippingRate[];
  shippingRules: ShippingRules;
  saveSetting: SaveSettingFn;
}) {
  const [zipsText, setZipsText] = useState(deliveryZips.join(", "));
  const [rates, setRates] = useState(shippingRates);
  const [rules, setRules] = useState(shippingRules);
  const [newRate, setNewRate] = useState({ name: "", price: "" });

  function saveZips() {
    const zips = zipsText.split(",").map((zip) => zip.trim()).filter(Boolean);
    void saveSetting("shipping.delivery_zips", zips, "Delivery ZIPs saved — checkout blocking updates immediately.");
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardTitle>Local delivery ZIP codes</CardTitle>
        <p className="mb-2 text-sm text-muted">
          Per-package delivery is hard-blocked outside these ZIPs (G-014). Changes apply on the next request.
        </p>
        <div className="flex gap-2">
          <Input value={zipsText} onChange={(event) => setZipsText(event.target.value)} placeholder="08701, 08527" className="flex-1" />
          <Button onClick={saveZips}>Save ZIPs</Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Delivery rates</CardTitle>
        <p className="mb-2 text-sm text-muted">Placeholder rates until live carrier quotes land (P8).</p>
        <ul className="space-y-1 text-sm">
          {rates.map((rate, index) => (
            <li key={`${rate.name}-${index}`} className="flex items-center gap-3">
              {rate.name} — {formatCents(rate.amountCents)}
              <Button variant="danger" className="ml-auto" onClick={() => setRates(rates.filter((_, i) => i !== index))}>
                Remove
              </Button>
            </li>
          ))}
          {rates.length === 0 && <li className="text-muted">No rates configured.</li>}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input placeholder="Rate name" value={newRate.name} onChange={(event) => setNewRate({ ...newRate, name: event.target.value })} />
          <Input placeholder="$" type="number" step="0.01" min="0" value={newRate.price} onChange={(event) => setNewRate({ ...newRate, price: event.target.value })} className="w-24" />
          <Button
            variant="secondary"
            onClick={() => {
              if (!newRate.name || newRate.price === "") return;
              setRates([...rates, { name: newRate.name, amountCents: Math.round(Number(newRate.price) * 100) }]);
              setNewRate({ name: "", price: "" });
            }}
          >
            Add row
          </Button>
          <Button onClick={() => saveSetting("shipping.rates", rates)}>Save rates</Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Delivery fee rules</CardTitle>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label>
            Bulk: fee per destination ($)
            <Input
              type="number"
              step="0.01"
              min="0"
              value={(rules.bulkFeePerDestinationCents / 100).toString()}
              onChange={(event) => setRules({ ...rules, bulkFeePerDestinationCents: Math.round(Number(event.target.value) * 100) })}
              className="mt-1 block w-28"
            />
          </label>
          <label>
            Per-package fee ($)
            <Input
              type="number"
              step="0.01"
              min="0"
              value={(rules.perPackageFeeCents / 100).toString()}
              onChange={(event) => setRules({ ...rules, perPackageFeeCents: Math.round(Number(event.target.value) * 100) })}
              className="mt-1 block w-28"
            />
          </label>
          <Button onClick={() => saveSetting("shipping.rules", rules)}>Save rules</Button>
        </div>
      </Card>
    </div>
  );
}

function EmailTab({
  emailFrom,
  emailReplyTo,
  saveSetting,
}: {
  emailFrom: string;
  emailReplyTo: string;
  saveSetting: SaveSettingFn;
}) {
  const [from, setFrom] = useState(emailFrom);
  const [replyTo, setReplyTo] = useState(emailReplyTo);

  return (
    <Card>
      <CardTitle>Email</CardTitle>
      <p className="mb-3 text-sm text-muted">Sender identity. Templates and delivery wiring arrive with the email phase.</p>
      <div className="space-y-3 text-sm">
        <label className="block">
          From address
          <Input value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full max-w-md" />
        </label>
        <label className="block">
          Reply-to address
          <Input value={replyTo} onChange={(event) => setReplyTo(event.target.value)} className="mt-1 block w-full max-w-md" />
        </label>
        <div className="flex gap-2">
          <Button onClick={() => saveSetting("email.from_address", from)}>Save from</Button>
          <Button variant="secondary" onClick={() => saveSetting("email.reply_to", replyTo)}>Save reply-to</Button>
        </div>
      </div>
    </Card>
  );
}

function DeveloperTab() {
  return (
    <Card>
      <CardTitle>Developer</CardTitle>
      <ul className="space-y-1 text-sm text-muted">
        <li>Web: port 3102 · DB: embedded Postgres on 4102 (`npm run db:start`)</li>
        <li>Media storage: Vercel Blob when BLOB_READ_WRITE_TOKEN is set; local `.uploads/` otherwise</li>
        <li>Webhook + API key management arrives with the Stripe/Shippo phases</li>
      </ul>
    </Card>
  );
}
