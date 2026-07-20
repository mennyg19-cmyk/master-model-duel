"use client";

import { useState } from "react";

const sampleLegacyDocument = JSON.stringify(
  {
    customers: [
      {
        id: "legacy-customer-1",
        displayName: "Legacy Customer",
        email: "legacy@example.test",
        addresses: [
          {
            id: "legacy-address-1",
            recipientName: "Legacy Recipient",
            line1: "1 Memory Lane",
            city: "Lakewood",
            region: "NJ",
            postalCode: "08701",
            greeting: "A freilichen Purim",
          },
        ],
      },
    ],
    products: [
      {
        id: "legacy-product-1",
        seasonYear: 2026,
        sku: "LEGACY-BOX",
        name: "Legacy Box",
        priceCents: 4200,
      },
    ],
    orders: [
      {
        id: "legacy-order-1",
        seasonYear: 2026,
        customerId: "legacy-customer-1",
        orderNumber: 10,
        totalCents: 4200,
        lines: [
          {
            productId: "legacy-product-1",
            quantity: 1,
            addressId: "legacy-address-1",
            greeting: "A freilichen Purim",
          },
        ],
      },
    ],
  },
  null,
  2,
);

export function LaunchReadinessConsole({
  seasons,
  isTestConsoleEnabled,
}: {
  seasons: Array<{ id: string; name: string }>;
  isTestConsoleEnabled: boolean;
}) {
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? "");
  const [legacyJson, setLegacyJson] = useState(sampleLegacyDocument);
  const [legacyBatchId, setLegacyBatchId] = useState("");
  const [message, setMessage] = useState("");

  async function reconcile() {
    const response = await fetch("/api/admin/stripe-reconciliation", {
      method: "POST",
    });
    const payload = await response.json();
    setMessage(
      response.ok
        ? `Stripe reconciliation completed with ${payload.findingCount} finding(s).`
        : payload.error,
    );
  }

  async function stageLegacyImport() {
    let document: unknown;
    try {
      document = JSON.parse(legacyJson);
    } catch {
      setMessage("Legacy JSON is not valid.");
      return;
    }
    const response = await fetch("/api/admin/legacy-imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceName: "legacy-export.json",
        dryRun: true,
        document,
      }),
    });
    const payload = await response.json();
    if (response.ok) {
      setLegacyBatchId(payload.id);
      const issues = Array.isArray(payload.issues) ? payload.issues.length : 0;
      setMessage(`Dry run staged with ${issues} issue(s).`);
    } else {
      setMessage(payload.error);
    }
  }

  async function commitLegacyImport() {
    const response = await fetch(
      `/api/admin/legacy-imports/${legacyBatchId}/commit`,
      { method: "POST" },
    );
    const payload = await response.json();
    setMessage(
      response.ok
        ? "Legacy customers, addresses, products, and orders committed atomically."
        : payload.error,
    );
  }

  async function testAction(action: "seed" | "reset" | "wipe" | "setMode", mode?: "TEST" | "LIVE") {
    const response = await fetch("/api/admin/test-console", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, mode }),
    });
    const payload = await response.json();
    setMessage(response.ok ? `Test console ${action} completed.` : payload.error);
  }

  async function completeTour(tourKey: string) {
    const response = await fetch("/api/admin/help", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tourKey }),
    });
    const payload = await response.json();
    setMessage(response.ok ? `${tourKey} tour marked complete.` : payload.error);
  }

  return (
    <div className="mt-8 grid gap-6">
      {message && (
        <p aria-live="polite" className="rounded-2xl bg-[var(--brand-soft)] p-4 font-semibold">
          {message}
        </p>
      )}
      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-black">Export center</h2>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="grid gap-2 text-sm font-bold">
            Season
            <select
              className="rounded-xl border border-[var(--border)] px-3 py-2"
              onChange={(event) => setSeasonId(event.target.value)}
              value={seasonId}
            >
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>{season.name}</option>
              ))}
            </select>
          </label>
          {["deliveries", "year-end", "year-metrics", "item-sales", "lapsed-customers"].map(
            (dataset) => (
              <a
                className="rounded-xl border border-[var(--brand)] px-4 py-2 font-bold text-[var(--brand)]"
                href={`/api/admin/exports?dataset=${dataset}&seasonId=${encodeURIComponent(seasonId)}`}
                key={dataset}
              >
                {dataset.replaceAll("-", " ")} CSV
              </a>
            ),
          )}
        </div>
        <button
          className="mt-5 rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white"
          onClick={() => void reconcile()}
          type="button"
        >
          Run Stripe reconciliation
        </button>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-black">Historical migration</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Entity map: customers → addresses → products by season → finalized historical
          orders and lines. Dry run validates references before one atomic commit.
        </p>
        <textarea
          className="mt-4 min-h-72 w-full rounded-xl border border-[var(--border)] p-3 font-mono text-xs"
          onChange={(event) => setLegacyJson(event.target.value)}
          value={legacyJson}
        />
        <div className="mt-4 flex gap-3">
          <button className="rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white" onClick={() => void stageLegacyImport()} type="button">
            Dry run
          </button>
          <button className="rounded-xl border border-[var(--brand)] px-5 py-3 font-bold text-[var(--brand)] disabled:opacity-40" disabled={!legacyBatchId} onClick={() => void commitLegacyImport()} type="button">
            Commit staged batch
          </button>
        </div>
      </section>

      {isTestConsoleEnabled && (
        <section className="rounded-3xl border border-amber-300 bg-amber-50 p-6">
          <h2 className="text-xl font-black">Test environment console</h2>
          <p className="mt-2 text-sm">Destructive controls are unavailable in production.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {(["seed", "reset", "wipe"] as const).map((action) => (
              <button className="rounded-xl border border-amber-800 px-4 py-2 font-bold" key={action} onClick={() => void testAction(action)} type="button">
                {action}
              </button>
            ))}
            <button className="rounded-xl border border-amber-800 px-4 py-2 font-bold" onClick={() => void testAction("setMode", "TEST")} type="button">Test mode</button>
            <button className="rounded-xl border border-amber-800 px-4 py-2 font-bold" onClick={() => void testAction("setMode", "LIVE")} type="button">Live mode</button>
          </div>
        </section>
      )}

      <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-black">Help center and guided tours</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ["orders", "Order desk", "Search, payment state, refunds, and audited changes."],
            ["fulfillment", "Fulfillment", "Group, print, pack, and ship without conflating stages."],
            ["delivery", "Delivery", "Build routes, confirm reroutes, and close pickup work."],
            ["reports", "Reports", "Read seasonal totals, export evidence, and reconcile Stripe."],
          ].map(([key, title, description]) => (
            <button className="rounded-2xl border border-[var(--border)] p-4 text-left hover:bg-[var(--surface)]" key={key} onClick={() => void completeTour(key)} type="button">
              <span className="font-black">{title}</span>
              <span className="mt-1 block text-sm text-[var(--muted)]">{description}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
