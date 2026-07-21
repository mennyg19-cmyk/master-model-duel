"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { STORE_SETTINGS } from "@/lib/storefront/settings-keys";

type Tab = "orders" | "shipping" | "email" | "developer" | "banner";

export function SettingsHub() {
  const [tab, setTab] = useState<Tab>("orders");
  const [zips, setZips] = useState("11218,11219,11230,11204");
  const [message, setMessage] = useState<string | null>(null);
  const [packageTypes, setPackageTypes] = useState<{ code: string; name: string }[]>([]);
  const [pickups, setPickups] = useState<{ code: string; name: string }[]>([]);
  const [checkZip, setCheckZip] = useState("11218");
  const [zipAllowed, setZipAllowed] = useState<boolean | null>(null);
  const [emailFrom, setEmailFrom] = useState("");
  const [emailReplyTo, setEmailReplyTo] = useState("");
  const [testEmailTo, setTestEmailTo] = useState("manager@tomchei.local");
  const [shippingRates, setShippingRates] = useState("{}");
  const [shippingRules, setShippingRules] = useState("{}");
  const [developerNotes, setDeveloperNotes] = useState("");
  const [bannerMessage, setBannerMessage] = useState("");
  const [bannerActive, setBannerActive] = useState(false);

  async function load() {
    const res = await fetch("/api/admin/store-settings");
    const json = await res.json();
    if (!res.ok) return;
    if (json.deliveryZips?.zips) setZips(json.deliveryZips.zips.join(","));
    setPackageTypes(json.packageTypes || []);
    setPickups(json.pickupLocations || []);
    if (json.emailFrom && typeof json.emailFrom === "object" && "address" in json.emailFrom) {
      setEmailFrom(String((json.emailFrom as { address?: string }).address ?? ""));
    } else if (typeof json.emailFrom === "string") {
      setEmailFrom(json.emailFrom);
    }
    if (json.emailReplyTo && typeof json.emailReplyTo === "object" && "address" in json.emailReplyTo) {
      setEmailReplyTo(String((json.emailReplyTo as { address?: string }).address ?? ""));
    } else if (typeof json.emailReplyTo === "string") {
      setEmailReplyTo(json.emailReplyTo);
    }
    if (json.shippingRates) setShippingRates(JSON.stringify(json.shippingRates, null, 2));
    if (json.shippingRules) setShippingRules(JSON.stringify(json.shippingRules, null, 2));
    if (json.developerNotes) {
      setDeveloperNotes(
        typeof json.developerNotes === "string"
          ? json.developerNotes
          : JSON.stringify(json.developerNotes),
      );
    }
    const bannerRes = await fetch("/api/admin/banner");
    const bannerJson = await bannerRes.json();
    if (bannerRes.ok && bannerJson.banner) {
      setBannerMessage(bannerJson.banner.message ?? "");
      setBannerActive(Boolean(bannerJson.banner.active));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function patchSetting(key: string, value: unknown) {
    setMessage(null);
    const res = await fetch("/api/admin/store-settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const json = await res.json();
    setMessage(res.ok ? "Saved." : json.error || "Save failed");
    return res.ok;
  }

  async function saveZips(e: React.FormEvent) {
    e.preventDefault();
    const ok = await patchSetting(STORE_SETTINGS.deliveryZips, {
      zips: zips.split(",").map((z) => z.trim()).filter(Boolean),
    });
    if (ok) await checkDeliveryZip(checkZip);
  }

  async function checkDeliveryZip(zip: string) {
    const res = await fetch(`/api/storefront/status?zip=${encodeURIComponent(zip)}`);
    const json = await res.json();
    setZipAllowed(json.zipAllowed);
  }

  async function saveBanner(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/admin/banner", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: bannerMessage, active: bannerActive }),
    });
    const json = await res.json();
    setMessage(res.ok ? "Banner saved." : json.error || "Save failed");
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "orders", label: "Orders" },
    { id: "shipping", label: "Shipping" },
    { id: "email", label: "Email" },
    { id: "banner", label: "Alert banner" },
    { id: "developer", label: "Developer" },
  ];

  return (
    <div className="space-y-4" data-testid="settings-hub">
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
        </section>
      ) : null}

      {tab === "shipping" ? (
        <section className="space-y-3 rounded bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Shipping</h2>
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
          <label className="block text-sm font-semibold">
            Shipping rates (JSON)
            <textarea
              className="mt-1 w-full rounded border px-2 py-1.5 font-mono text-xs font-normal"
              rows={4}
              value={shippingRates}
              onChange={(e) => setShippingRates(e.target.value)}
              data-testid="shipping-rates"
            />
          </label>
          <Button
            type="button"
            onClick={() => {
              try {
                void patchSetting(STORE_SETTINGS.shippingRates, JSON.parse(shippingRates || "{}"));
              } catch {
                setMessage("Invalid rates JSON");
              }
            }}
          >
            Save rates
          </Button>
          <label className="block text-sm font-semibold">
            Shipping rules (JSON)
            <textarea
              className="mt-1 w-full rounded border px-2 py-1.5 font-mono text-xs font-normal"
              rows={4}
              value={shippingRules}
              onChange={(e) => setShippingRules(e.target.value)}
              data-testid="shipping-rules"
            />
          </label>
          <Button
            type="button"
            onClick={() => {
              try {
                void patchSetting(STORE_SETTINGS.shippingRules, JSON.parse(shippingRules || "{}"));
              } catch {
                setMessage("Invalid rules JSON");
              }
            }}
          >
            Save rules
          </Button>
          {message ? <p className="text-sm">{message}</p> : null}
        </section>
      ) : null}

      {tab === "email" ? (
        <section className="space-y-3 rounded bg-white p-4 shadow-sm text-sm">
          <h2 className="font-semibold">Email</h2>
          <label className="block font-semibold">
            From address
            <input
              className="mt-1 w-full rounded border px-2 py-1.5 font-normal"
              value={emailFrom}
              onChange={(e) => setEmailFrom(e.target.value)}
              data-testid="email-from"
            />
          </label>
          <Button
            type="button"
            onClick={() => patchSetting(STORE_SETTINGS.emailFrom, { address: emailFrom })}
          >
            Save from
          </Button>
          <label className="block font-semibold">
            Reply-to
            <input
              className="mt-1 w-full rounded border px-2 py-1.5 font-normal"
              value={emailReplyTo}
              onChange={(e) => setEmailReplyTo(e.target.value)}
              data-testid="email-reply-to"
            />
          </label>
          <Button
            type="button"
            onClick={() => patchSetting(STORE_SETTINGS.emailReplyTo, { address: emailReplyTo })}
          >
            Save reply-to
          </Button>
          <label className="block font-semibold">
            Test send to
            <input
              className="mt-1 w-full rounded border px-2 py-1.5 font-normal"
              value={testEmailTo}
              onChange={(e) => setTestEmailTo(e.target.value)}
              data-testid="email-test-to"
            />
          </label>
          <Button
            type="button"
            data-testid="email-test-send"
            onClick={async () => {
              setMessage(null);
              const res = await fetch("/api/admin/email", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "test_email", to: testEmailTo }),
              });
              const json = await res.json();
              setMessage(
                res.ok
                  ? json.captured
                    ? "Test captured (no provider)."
                    : "Test sent."
                  : json.error || "Test failed",
              );
            }}
          >
            Send test email
          </Button>
          {message ? <p>{message}</p> : null}
        </section>
      ) : null}

      {tab === "banner" ? (
        <section className="space-y-3 rounded bg-white p-4 shadow-sm text-sm">
          <h2 className="font-semibold">Admin alert banner</h2>
          <form onSubmit={saveBanner} className="space-y-2">
            <label className="block font-semibold">
              Message
              <input
                className="mt-1 w-full rounded border px-2 py-1.5 font-normal"
                value={bannerMessage}
                onChange={(e) => setBannerMessage(e.target.value)}
                data-testid="banner-message"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={bannerActive}
                onChange={(e) => setBannerActive(e.target.checked)}
                data-testid="banner-active"
              />
              Active
            </label>
            <Button type="submit">Save banner</Button>
          </form>
          {message ? <p>{message}</p> : null}
        </section>
      ) : null}

      {tab === "developer" ? (
        <section className="space-y-3 rounded bg-white p-4 shadow-sm text-sm">
          <h2 className="font-semibold">Developer</h2>
          <label className="block font-semibold">
            Notes
            <textarea
              className="mt-1 w-full rounded border px-2 py-1.5 font-normal"
              rows={4}
              value={developerNotes}
              onChange={(e) => setDeveloperNotes(e.target.value)}
              data-testid="developer-notes"
            />
          </label>
          <Button
            type="button"
            onClick={() => patchSetting(STORE_SETTINGS.developerNotes, { text: developerNotes })}
          >
            Save notes
          </Button>
          <p className="text-[var(--color-ink)]/70">Test mode / launch readiness land in P12.</p>
          {message ? <p>{message}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
