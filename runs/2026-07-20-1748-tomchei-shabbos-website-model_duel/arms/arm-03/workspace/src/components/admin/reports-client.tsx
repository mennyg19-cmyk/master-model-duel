"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type SeasonRow = {
  seasonId: string;
  name: string;
  year: number;
  orderCount: number;
  paidOrderCount: number;
  packageCount: number;
  revenueCents: number;
  byMethod: Record<string, number>;
};

type MarginReport = {
  labelCount: number;
  chargedCents: number;
  purchasedCents: number;
  marginCents: number;
  packages: Array<{
    packageId: string;
    chargedCents: number;
    purchasedCents: number;
    marginCents: number;
    carrier: string;
  }>;
};

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ReportsClient() {
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [margin, setMargin] = useState<MarginReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    const [p, m] = await Promise.all([
      fetch("/api/admin/reports?kind=performance"),
      fetch("/api/admin/reports?kind=margin"),
    ]);
    const pj = await p.json();
    const mj = await m.json();
    if (!p.ok) {
      setError(pj.error || "Performance report failed");
      return;
    }
    if (!m.ok) {
      setError(mj.error || "Margin report failed");
      return;
    }
    setSeasons(pj.seasons ?? []);
    setMargin(mj.report ?? null);
  }

  useEffect(() => {
    void load();
  }, []);

  const totals = {
    orderCount: seasons.reduce((s, r) => s + r.orderCount, 0),
    paidOrderCount: seasons.reduce((s, r) => s + r.paidOrderCount, 0),
    packageCount: seasons.reduce((s, r) => s + r.packageCount, 0),
    revenueCents: seasons.reduce((s, r) => s + r.revenueCents, 0),
  };

  return (
    <div className="space-y-6" data-testid="reports-hub">
      <Button type="button" onClick={() => void load()} data-testid="reports-refresh">
        Refresh
      </Button>
      {error ? (
        <p className="text-sm text-red-700" data-testid="reports-error">
          {error}
        </p>
      ) : null}

      <section className="rounded bg-white p-4 shadow-sm" data-testid="reports-performance">
        <h2 className="font-semibold">Multi-season performance</h2>
        <p className="mt-1 text-sm opacity-70" data-testid="reports-perf-totals">
          Orders {totals.orderCount} · Paid {totals.paidOrderCount} · Packages {totals.packageCount}{" "}
          · Revenue {money(totals.revenueCents)}
        </p>
        <ul className="mt-3 space-y-3">
          {seasons.map((s) => (
            <li key={s.seasonId} data-testid={`reports-season-${s.year}`}>
              <p className="text-sm font-medium">
                {s.name} {s.year} — {money(s.revenueCents)} / {s.orderCount} orders
              </p>
              <ul className="ml-3 text-xs opacity-80">
                {Object.entries(s.byMethod).map(([code, count]) => (
                  <li key={code}>
                    {code}: {count} pkgs
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      {margin ? (
        <section className="rounded bg-white p-4 shadow-sm" data-testid="reports-margin">
          <h2 className="font-semibold">Shipping-margin reconciliation</h2>
          <p className="mt-1 text-sm opacity-70" data-testid="reports-margin-totals">
            Labels {margin.labelCount} · Charged {money(margin.chargedCents)} · Paid{" "}
            {money(margin.purchasedCents)} · Margin {money(margin.marginCents)}
          </p>
          <ul className="mt-3 max-h-64 space-y-1 overflow-auto text-xs">
            {margin.packages.slice(0, 40).map((p) => (
              <li key={p.packageId}>
                {p.carrier}: charge {money(p.chargedCents)} / buy {money(p.purchasedCents)} / margin{" "}
                {money(p.marginCents)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
