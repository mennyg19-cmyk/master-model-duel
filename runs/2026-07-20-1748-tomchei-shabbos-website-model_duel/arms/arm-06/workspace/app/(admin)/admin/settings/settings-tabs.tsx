"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { dollarsToCents, formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ShippingState {
  deliveryZips: string[];
  rates: { name: string; feeCents: number }[];
  rules: { name: string; description: string }[];
  fees: { bulkPerDestinationCents: number; perPackagePerRecipientCents: number };
  days: string[];
}

interface OrdersState {
  packageTypes: {
    id: string;
    name: string;
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    maxWeightGrams: number | null;
    active: boolean;
  }[];
  pickupLocations: {
    id: string;
    name: string;
    line1: string;
    city: string;
    region: string;
    postalCode: string;
    active: boolean;
  }[];
}

const TABS = ["Orders", "Shipping", "Email", "Developer"] as const;
type Tab = (typeof TABS)[number];

// R-094/R-095: settings hub tabs. Every write hits the settings APIs and the
// list re-renders from fresh server data (router.refresh) — the delivery-ZIP
// allowlist is read live by /checkout and /api/delivery-check.
export function SettingsTabs({
  shipping,
  orders,
  developer,
  storeStatus,
}: {
  shipping: ShippingState;
  orders: OrdersState;
  developer: { storageDriver: string };
  storeStatus: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Orders");
  const [zipsText, setZipsText] = useState(shipping.deliveryZips.join(", "));
  const [rateName, setRateName] = useState("");
  const [rateFee, setRateFee] = useState("");
  const [bulkFee, setBulkFee] = useState((shipping.fees.bulkPerDestinationCents / 100).toFixed(2));
  const [perPackageFee, setPerPackageFee] = useState((shipping.fees.perPackagePerRecipientCents / 100).toFixed(2));
  const [daysText, setDaysText] = useState(shipping.days.join("\n"));
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reportSaveResult(apiResult: { ok: boolean; body: { error?: string } }, okMessage: string) {
    if (apiResult.ok) {
      setStatus(okMessage);
      setError(null);
      router.refresh();
    } else {
      setError(apiResult.body.error ?? "Could not save");
      setStatus(null);
    }
  }

  async function saveZips(event: FormEvent) {
    event.preventDefault();
    const deliveryZips = zipsText
      .split(/[,\s]+/)
      .map((zip) => zip.trim())
      .filter(Boolean);
    reportSaveResult(
      await apiFetch("/api/admin/settings", {
        method: "POST",
        body: { key: "shipping.deliveryZips", value: deliveryZips },
      }),
      "Delivery ZIPs saved — the checkout checker reads this list live.",
    );
  }

  async function addRate(event: FormEvent) {
    event.preventDefault();
    const feeCents = dollarsToCents(Number(rateFee));
    if (!rateName.trim() || feeCents === null) {
      setError("Fee must be a clean dollar-and-cents amount");
      setStatus(null);
      return;
    }
    const next = [...shipping.rates, { name: rateName.trim(), feeCents }];
    const apiResult = await apiFetch("/api/admin/settings", {
      method: "POST",
      body: { key: "shipping.rates", value: next },
    });
    reportSaveResult(apiResult, "Shipping rate added.");
    if (apiResult.ok) {
      setRateName("");
      setRateFee("");
    }
  }

  async function saveDeliveryFees(event: FormEvent) {
    event.preventDefault();
    const bulkPerDestinationCents = dollarsToCents(Number(bulkFee));
    const perPackagePerRecipientCents = dollarsToCents(Number(perPackageFee));
    if (bulkPerDestinationCents === null || perPackagePerRecipientCents === null) {
      setError("Fees must be clean dollar-and-cents amounts");
      setStatus(null);
      return;
    }
    reportSaveResult(
      await apiFetch("/api/admin/settings", {
        method: "POST",
        body: { key: "delivery.fees", value: { bulkPerDestinationCents, perPackagePerRecipientCents } },
      }),
      "Checkout delivery fees saved.",
    );
  }

  async function saveDeliveryDays(event: FormEvent) {
    event.preventDefault();
    const days = daysText
      .split("\n")
      .map((day) => day.trim())
      .filter(Boolean);
    reportSaveResult(
      await apiFetch("/api/admin/settings", { method: "POST", body: { key: "delivery.days", value: days } }),
      "Delivery days saved — per-package checkout offers this list live.",
    );
  }

  async function addPackageType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    reportSaveResult(
      await apiFetch("/api/admin/package-types", {
        method: "POST",
        body: {
          name: String(form.get("name") ?? ""),
          lengthMm: Number(form.get("lengthMm")),
          widthMm: Number(form.get("widthMm")),
          heightMm: Number(form.get("heightMm")),
          maxWeightGrams: form.get("maxWeightGrams") ? Number(form.get("maxWeightGrams")) : null,
        },
      }),
      "Package type added.",
    );
    (event.target as HTMLFormElement).reset();
  }

  async function togglePackageType(id: string, active: boolean) {
    reportSaveResult(await apiFetch(`/api/admin/package-types/${id}`, { method: "PATCH", body: { active } }), "Updated.");
  }

  async function addPickupLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    reportSaveResult(
      await apiFetch("/api/admin/pickup-locations", {
        method: "POST",
        body: {
          name: String(form.get("name") ?? ""),
          line1: String(form.get("line1") ?? ""),
          city: String(form.get("city") ?? ""),
          region: String(form.get("region") ?? ""),
          postalCode: String(form.get("postalCode") ?? ""),
        },
      }),
      "Pickup location added.",
    );
    (event.target as HTMLFormElement).reset();
  }

  async function togglePickupLocation(id: string, active: boolean) {
    reportSaveResult(await apiFetch(`/api/admin/pickup-locations/${id}`, { method: "PATCH", body: { active } }), "Updated.");
  }

  return (
    <div className="mt-4">
      <nav className="flex gap-1 border-b border-stone-200" aria-label="Settings sections">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === name
                ? "border-b-2 border-brand-700 text-brand-700"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            {name}
          </button>
        ))}
      </nav>

      {status && <p className="mt-3 text-sm text-green-700">{status}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {tab === "Orders" && (
        <div className="mt-6">
          <p className="mb-6 text-sm text-stone-600">
            Store status: <span className="font-medium text-stone-900">{storeStatus}</span>
          </p>
          <div className="grid gap-8 lg:grid-cols-2">
          <section>
            <h2 className="text-lg font-semibold">Package types</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {orders.packageTypes.map((packageType) => (
                <li
                  key={packageType.id}
                  className="flex items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                >
                  <span>
                    {packageType.name} — {packageType.lengthMm}×{packageType.widthMm}×
                    {packageType.heightMm} mm
                    {packageType.maxWeightGrams ? `, up to ${packageType.maxWeightGrams} g` : ""}
                  </span>
                  <button
                    type="button"
                    className="text-brand-700 hover:underline"
                    onClick={() => togglePackageType(packageType.id, !packageType.active)}
                  >
                    {packageType.active ? "Deactivate" : "Activate"}
                  </button>
                </li>
              ))}
              {orders.packageTypes.length === 0 && (
                <li className="text-sm text-stone-500">No package types yet.</li>
              )}
            </ul>
            <form onSubmit={addPackageType} className="mt-3 flex flex-wrap gap-2">
              <Input name="name" placeholder="Name" required className="max-w-[10rem]" />
              <Input name="lengthMm" type="number" min="1" placeholder="L mm" required className="max-w-[6rem]" />
              <Input name="widthMm" type="number" min="1" placeholder="W mm" required className="max-w-[6rem]" />
              <Input name="heightMm" type="number" min="1" placeholder="H mm" required className="max-w-[6rem]" />
              <Input name="maxWeightGrams" type="number" min="1" placeholder="Max g" className="max-w-[6rem]" />
              <Button type="submit" size="sm">Add</Button>
            </form>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Pickup locations</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {orders.pickupLocations.map((location) => (
                <li
                  key={location.id}
                  className="flex items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
                >
                  <span>
                    {location.name} — {location.line1}, {location.city}, {location.region} {location.postalCode}
                    {!location.active && <Badge tone="stone">Inactive</Badge>}
                  </span>
                  <button
                    type="button"
                    className="text-brand-700 hover:underline"
                    onClick={() => togglePickupLocation(location.id, !location.active)}
                  >
                    {location.active ? "Deactivate" : "Activate"}
                  </button>
                </li>
              ))}
              {orders.pickupLocations.length === 0 && (
                <li className="text-sm text-stone-500">No pickup locations yet.</li>
              )}
            </ul>
            <form onSubmit={addPickupLocation} className="mt-3 flex flex-wrap gap-2">
              <Input name="name" placeholder="Name" required className="max-w-[10rem]" />
              <Input name="line1" placeholder="Street" required className="max-w-[12rem]" />
              <Input name="city" placeholder="City" required className="max-w-[8rem]" />
              <Input name="region" placeholder="State" required className="max-w-[5rem]" />
              <Input name="postalCode" placeholder="ZIP" pattern="\d{5}" required className="max-w-[6rem]" />
              <Button type="submit" size="sm">Add</Button>
            </form>
          </section>
          </div>
        </div>
      )}

      {tab === "Shipping" && (
        <div className="mt-6 grid gap-8 lg:grid-cols-2">
          <section>
            <h2 className="text-lg font-semibold">Delivery ZIPs</h2>
            <p className="mt-1 text-sm text-stone-600">
              The checkout delivery checker and the delivery routes read this allowlist live.
            </p>
            <form onSubmit={saveZips} className="mt-3">
              <Label htmlFor="delivery-zips">Allowed ZIPs (comma or space separated)</Label>
              <textarea
                id="delivery-zips"
                value={zipsText}
                onChange={(event) => setZipsText(event.target.value)}
                rows={4}
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <Button type="submit" size="sm" className="mt-2">Save ZIPs</Button>
            </form>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Checkout delivery (P5)</h2>
            <p className="mt-1 text-sm text-stone-600">
              Bulk delivery bills once per destination; per-package delivery bills per recipient and
              is hard-blocked outside the ZIP allowlist.
            </p>
            <form onSubmit={saveDeliveryFees} className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="bulk-fee">Bulk / destination</Label>
                <Input
                  id="bulk-fee"
                  value={bulkFee}
                  onChange={(event) => setBulkFee(event.target.value)}
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  className="max-w-[7rem]"
                />
              </div>
              <div>
                <Label htmlFor="per-package-fee">Per-package / recipient</Label>
                <Input
                  id="per-package-fee"
                  value={perPackageFee}
                  onChange={(event) => setPerPackageFee(event.target.value)}
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  className="max-w-[7rem]"
                />
              </div>
              <Button type="submit" size="sm">Save fees</Button>
            </form>
            <form onSubmit={saveDeliveryDays} className="mt-4">
              <Label htmlFor="delivery-days">Purim-week delivery days (one per line)</Label>
              <textarea
                id="delivery-days"
                value={daysText}
                onChange={(event) => setDaysText(event.target.value)}
                rows={4}
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <Button type="submit" size="sm" className="mt-2">Save days</Button>
            </form>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Delivery fees</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {shipping.rates.map((rate) => (
                <li key={rate.name} className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm">
                  {rate.name} — {formatCents(rate.feeCents)}
                </li>
              ))}
              {shipping.rates.length === 0 && <li className="text-sm text-stone-500">No fees configured.</li>}
            </ul>
            <form onSubmit={addRate} className="mt-3 flex gap-2">
              <Input
                value={rateName}
                onChange={(event) => setRateName(event.target.value)}
                placeholder="Rate name"
                required
                className="max-w-[12rem]"
              />
              <Input
                value={rateFee}
                onChange={(event) => setRateFee(event.target.value)}
                type="number"
                step="0.01"
                min="0"
                placeholder="$0.00"
                required
                className="max-w-[7rem]"
              />
              <Button type="submit" size="sm">Add</Button>
            </form>

            <h2 className="mt-8 text-lg font-semibold">Shipping rules</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {shipping.rules.map((rule) => (
                <li key={rule.name} className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm">
                  <span className="font-medium">{rule.name}</span> — {rule.description}
                </li>
              ))}
              {shipping.rules.length === 0 && (
                <li className="text-sm text-stone-500">
                  Seeded with the packing default: only Shabbos-appropriate, shelf-stable foods.
                </li>
              )}
            </ul>
          </section>
        </div>
      )}

      {tab === "Email" && (
        <div className="mt-6 max-w-2xl">
          <h2 className="text-lg font-semibold">Email platform</h2>
          <p className="mt-2 text-sm text-stone-600">
            Transactional email (welcome, order confirmation, delivery updates, deadline reminders)
            ships in P11 when the customer flows exist to trigger it. This tab will show the
            provider configuration, template status, and a send log.
          </p>
          <p className="mt-2 text-sm text-stone-600">
            The newsletter unsubscribe/preference flow is already live — subscribers manage state at
            <code className="mx-1 rounded bg-stone-100 px-1">/unsubscribe</code> with signed links.
          </p>
        </div>
      )}

      {tab === "Developer" && (
        <div className="mt-6 max-w-2xl">
          <h2 className="text-lg font-semibold">Developer</h2>
          <dl className="mt-3 text-sm">
            <dt className="font-medium text-stone-700">Media storage driver</dt>
            <dd className="mt-1 text-stone-600">
              {developer.storageDriver} — switch by setting{" "}
              <code className="rounded bg-stone-100 px-1">BLOB_READ_WRITE_TOKEN</code>.
            </dd>
            <dt className="mt-4 font-medium text-stone-700">API keys</dt>
            <dd className="mt-1 text-stone-600">
              Outbound webhook / integration keys land with the driver and email integrations in
              later phases. No third-party keys are required for P3.
            </dd>
          </dl>
        </div>
      )}
    </div>
  );
}
