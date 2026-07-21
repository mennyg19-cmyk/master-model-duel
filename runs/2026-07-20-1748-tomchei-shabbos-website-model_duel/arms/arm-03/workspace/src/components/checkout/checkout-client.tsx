"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatCents } from "@/lib/storefront/catalog-shared";

type Summary = {
  draftRef: string;
  greetingDefault: string | null;
  donationCents: number;
  subtotalCents: number;
  totalCents: number;
  fees: {
    bulkDestinationCount: number;
    bulkFeeCents: number;
    perPackageRecipientCount: number;
    perPackageFeeCents: number;
    shipFeeCents: number;
    totalFeeCents: number;
    blockedZips: string[];
  };
  conflicts: Array<{ kind: string; message: string }>;
  purimDays: string[];
  methods: Array<{ code: string; label: string; description: string | null }>;
  lines: Array<{
    id: string;
    productName: string;
    quantity: number;
    lineTotalCents: number;
    recipientName: string | null;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    fulfillmentMethodCode: string | null;
    greeting: string;
    rememberedGreeting: string | null;
    effectiveGreeting: string;
  }>;
};

export function CheckoutClient({
  draftRef,
  mode = "storefront",
}: {
  draftRef: string;
  mode?: "storefront" | "pos";
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [greetingDefault, setGreetingDefault] = useState("");
  const [methodByLine, setMethodByLine] = useState<Record<string, string>>({});
  const [greetingByLine, setGreetingByLine] = useState<Record<string, string>>({});
  const [purimByLine, setPurimByLine] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/checkout?draft=${encodeURIComponent(draftRef)}`);
    const json = await res.json();
    if (!json.ok) {
      setError(json.error || "Could not load checkout");
      return;
    }
    const s = json.summary as Summary;
    setSummary(s);
    setGreetingDefault(s.greetingDefault ?? "");
    const methods: Record<string, string> = {};
    const greetings: Record<string, string> = {};
    for (const line of s.lines) {
      methods[line.id] = line.fulfillmentMethodCode ?? "PICKUP";
      greetings[line.id] = line.greeting || line.rememberedGreeting || "";
    }
    setMethodByLine(methods);
    setGreetingByLine(greetings);
  }, [draftRef]);

  useEffect(() => {
    void load();
  }, [load]);

  const recipientGroups = useMemo(() => {
    if (!summary) return [];
    const map = new Map<string, typeof summary.lines>();
    for (const line of summary.lines) {
      const key = [
        line.recipientName,
        line.addressLine1,
        line.city,
        line.state,
        line.postalCode,
      ].join("|");
      const list = map.get(key) ?? [];
      list.push(line);
      map.set(key, list);
    }
    return [...map.entries()].map(([key, lines]) => ({ key, lines }));
  }, [summary]);

  async function prepareAndMaybePay(pay: "stripe" | "cash" | "check", refreshPrices = false) {
    if (!summary) return;
    setBusy(true);
    setError(null);
    try {
      const recipients = recipientGroups.map((g) => {
        const head = g.lines[0]!;
        return {
          lineIds: g.lines.map((l) => l.id),
          fulfillmentMethodCode: methodByLine[head.id] ?? "PICKUP",
          greeting: greetingByLine[head.id] || null,
          purimDay: purimByLine[head.id] || null,
        };
      });

      const prep = await fetch("/api/checkout?action=prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftRef,
          greetingDefault,
          donationCents: summary.donationCents,
          clientExpectedTotalCents: refreshPrices ? null : summary.totalCents,
          refreshPrices: refreshPrices || undefined,
          recipients,
        }),
      });
      const prepJson = await prep.json();
      if (prepJson.conflicts?.length) {
        setSummary(prepJson.summary);
        setError(prepJson.conflicts.map((c: { message: string }) => c.message).join(" "));
        return;
      }
      if (!prepJson.ok) {
        setError(prepJson.error || "Prepare failed");
        return;
      }
      setSummary(prepJson.summary);

      if (refreshPrices) return;

      if (pay === "stripe") {
        const start = await fetch("/api/checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            draftRef,
            clientExpectedTotalCents: prepJson.summary.totalCents,
          }),
        });
        const startJson = await start.json();
        if (!startJson.ok) {
          if (startJson.conflicts?.length) {
            setError(startJson.conflicts.map((c: { message: string }) => c.message).join(" "));
          } else {
            setError(startJson.error || "Stripe checkout failed");
          }
          return;
        }
        window.location.href = startJson.url;
        return;
      }

      const offline = await fetch("/api/checkout/offline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftRef,
          method: pay === "cash" ? "CASH" : "CHECK",
          amountCents: prepJson.summary.totalCents,
          recipients,
          greetingDefault,
        }),
      });
      const offlineJson = await offline.json();
      if (!offlineJson.ok) {
        setError(
          typeof offlineJson.error === "string"
            ? offlineJson.error
            : offlineJson.conflicts?.[0]?.message || "POS payment failed",
        );
        return;
      }
      window.location.href = `/checkout/success?draft=${encodeURIComponent(draftRef)}&pos=1`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const hasStalePrice = summary?.conflicts.some(
    (c) => c.kind === "stale_price" || c.kind === "stale_addon_price",
  );

  if (error && !summary) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center" data-testid="checkout-error">
        <p className="text-red-700">{error}</p>
        <Link href="/order" className="mt-4 inline-block text-sm font-semibold">
          Back to cart
        </Link>
      </main>
    );
  }

  if (!summary) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center" data-testid="checkout-loading">
        Loading checkout…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10" data-testid="checkout-page">
      <div className="flex items-center justify-between">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Checkout
        </h1>
        <Link href={mode === "pos" ? "/admin/pos" : "/order"} className="text-sm font-semibold">
          Back
        </Link>
      </div>
      <p className="text-sm text-[var(--color-ink)]/70" data-testid="checkout-draft-ref">
        {summary.draftRef}
      </p>

      <label className="block space-y-1">
        <span className="text-sm font-semibold">Order default greeting</span>
        <input
          className="w-full rounded border px-3 py-2"
          value={greetingDefault}
          onChange={(e) => setGreetingDefault(e.target.value)}
          data-testid="greeting-default"
        />
      </label>

      <section className="space-y-4" data-testid="checkout-recipients">
        {recipientGroups.map((g) => {
          const head = g.lines[0]!;
          return (
            <div
              key={g.key}
              className="rounded border bg-white p-4"
              data-testid={`recipient-${head.id}`}
            >
              <p className="font-semibold">
                {head.recipientName} — {head.addressLine1}, {head.city} {head.state}{" "}
                {head.postalCode}
              </p>
              <p className="text-xs text-[var(--color-ink)]/60">
                {g.lines.length} line(s) · {formatCents(g.lines.reduce((s, l) => s + l.lineTotalCents, 0))}
              </p>
              <label className="mt-3 block space-y-1">
                <span className="text-sm">Fulfillment</span>
                <select
                  className="w-full rounded border px-3 py-2"
                  value={methodByLine[head.id] ?? "PICKUP"}
                  onChange={(e) => {
                    const code = e.target.value;
                    setMethodByLine((prev) => {
                      const next = { ...prev };
                      for (const line of g.lines) next[line.id] = code;
                      return next;
                    });
                  }}
                  data-testid={`fulfillment-${head.id}`}
                >
                  {summary.methods.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              {(methodByLine[head.id] === "BULK_DELIVERY" ||
                methodByLine[head.id] === "PER_PACKAGE_DELIVERY") && (
                <label className="mt-2 block space-y-1">
                  <span className="text-sm">Purim-week day</span>
                  <select
                    className="w-full rounded border px-3 py-2"
                    value={purimByLine[head.id] ?? ""}
                    onChange={(e) =>
                      setPurimByLine((prev) => ({ ...prev, [head.id]: e.target.value }))
                    }
                    data-testid={`purim-day-${head.id}`}
                  >
                    <option value="">Select day</option>
                    {summary.purimDays.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="mt-2 block space-y-1">
                <span className="text-sm">Greeting override</span>
                <input
                  className="w-full rounded border px-3 py-2"
                  value={greetingByLine[head.id] ?? ""}
                  placeholder={head.rememberedGreeting || greetingDefault || "Greeting"}
                  onChange={(e) => {
                    const value = e.target.value;
                    setGreetingByLine((prev) => {
                      const next = { ...prev };
                      for (const line of g.lines) next[line.id] = value;
                      return next;
                    });
                  }}
                  data-testid={`greeting-${head.id}`}
                />
              </label>
            </div>
          );
        })}
      </section>

      <section className="rounded border bg-white p-4" data-testid="checkout-totals">
        <p>Subtotal: {formatCents(summary.subtotalCents)}</p>
        <p>
          Delivery fees: {formatCents(summary.fees.totalFeeCents)}
          <span className="text-xs text-[var(--color-ink)]/60">
            {" "}
            (bulk×{summary.fees.bulkDestinationCount}, per-pkg×
            {summary.fees.perPackageRecipientCount})
          </span>
        </p>
        <p className="text-lg font-semibold" data-testid="checkout-total">
          Total: {formatCents(summary.totalCents)}
        </p>
      </section>

      {(summary.conflicts.length > 0 || error) && (
        <div
          className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
          data-testid="checkout-conflicts"
        >
          {error ? <p>{error}</p> : null}
          {summary.conflicts.map((c, i) => (
            <p key={i}>{c.message}</p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {hasStalePrice ? (
          <button
            type="button"
            disabled={busy}
            className="rounded border border-amber-600 px-4 py-2 text-sm font-semibold text-amber-900"
            onClick={() => prepareAndMaybePay("stripe", true)}
            data-testid="refresh-prices"
          >
            Refresh prices
          </button>
        ) : null}
        {mode === "storefront" ? (
          <button
            type="button"
            disabled={busy}
            className="rounded bg-[var(--color-leaf)] px-4 py-2 text-sm font-semibold text-white"
            onClick={() => prepareAndMaybePay("stripe")}
            data-testid="pay-stripe"
          >
            Pay with Stripe
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              className="rounded bg-[var(--color-leaf)] px-4 py-2 text-sm font-semibold text-white"
              onClick={() => prepareAndMaybePay("cash")}
              data-testid="pay-cash"
            >
              Post cash
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded border px-4 py-2 text-sm font-semibold"
              onClick={() => prepareAndMaybePay("check")}
              data-testid="pay-check"
            >
              Post check
            </button>
          </>
        )}
      </div>
    </main>
  );
}
