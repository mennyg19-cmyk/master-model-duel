"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Channel = {
  methodId: string;
  code: string;
  name: string;
  total: number;
  byStage: Record<string, number>;
};

export function FulfillmentDashboardClient() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [production, setProduction] = useState<{
    openPackages: number;
    shippedOrPicked: number;
    totalPackages: number;
  } | null>(null);
  const [savings, setSavings] = useState<{ printedAwaitingShip: number; note: string } | null>(
    null,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [packages, setPackages] = useState<
    Array<{ id: string; version: number; stage: string; fulfillmentMethod: { code: string } }>
  >([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [dash, pkgs] = await Promise.all([
      fetch("/api/admin/fulfillment").then((r) => r.json()),
      fetch("/api/admin/packages?pageSize=100").then((r) => r.json()),
    ]);
    if (dash.ok) {
      setChannels(dash.channels ?? []);
      setProduction(dash.production ?? null);
      setSavings(dash.savings ?? null);
    }
    if (pkgs.ok) setPackages(pkgs.packages ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function bulkStage(toStage: string) {
    setMessage(null);
    const items = packages
      .filter((p) => selected.has(p.id))
      .map((p) => ({ packageId: p.id, expectedVersion: p.version }));
    const res = await fetch("/api/admin/packages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stage", toStage, items }),
    });
    const json = await res.json();
    setMessage(
      res.ok
        ? `Updated ${json.updated?.length ?? 0}, skipped ${json.skipped?.length ?? 0}`
        : json.error || "Bulk failed",
    );
    if (res.ok) {
      setSelected(new Set());
      await load();
    }
  }

  return (
    <div className="space-y-4" data-testid="fulfillment-dashboard">
      <div className="grid gap-3 sm:grid-cols-3" data-testid="fulfillment-summaries">
        <div className="rounded bg-white p-4 shadow-sm">
          <p className="text-xs uppercase opacity-60">Open packages</p>
          <p className="text-2xl font-semibold">{production?.openPackages ?? "—"}</p>
        </div>
        <div className="rounded bg-white p-4 shadow-sm">
          <p className="text-xs uppercase opacity-60">Shipped / picked up</p>
          <p className="text-2xl font-semibold">{production?.shippedOrPicked ?? "—"}</p>
        </div>
        <div className="rounded bg-white p-4 shadow-sm">
          <p className="text-xs uppercase opacity-60">Printed awaiting ship</p>
          <p className="text-2xl font-semibold">{savings?.printedAwaitingShip ?? "—"}</p>
          <p className="mt-1 text-xs opacity-60">{savings?.note}</p>
        </div>
      </div>

      <section className="rounded bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Channels</h2>
        <ul className="mt-2 space-y-2 text-sm" data-testid="fulfillment-channels">
          {channels.map((c) => (
            <li key={c.methodId} className="rounded border px-3 py-2">
              <span className="font-semibold">{c.code}</span> — {c.name} · {c.total} pkgs
              <div className="mt-1 text-xs opacity-70">
                NEW {c.byStage.NEW ?? 0} · PRINTED {c.byStage.PRINTED ?? 0} · PACKED{" "}
                {c.byStage.PACKED ?? 0} · SENT {c.byStage.SENT ?? 0} · PICKED_UP{" "}
                {c.byStage.PICKED_UP ?? 0}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 rounded bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Bulk status</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void bulkStage("PRINTED")} data-testid="fulfillment-bulk-printed">
            Mark Printed
          </Button>
          <Button type="button" onClick={() => void bulkStage("PACKED")} data-testid="fulfillment-bulk-packed">
            Mark Packed
          </Button>
          <Button type="button" onClick={() => void bulkStage("SENT")} data-testid="fulfillment-bulk-sent">
            Mark Sent
          </Button>
        </div>
        <ul className="max-h-64 space-y-1 overflow-auto text-xs">
          {packages.map((p) => (
            <li key={p.id}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    })
                  }
                />
                {p.fulfillmentMethod.code} · {p.stage} · {p.id.slice(0, 8)}
              </label>
            </li>
          ))}
        </ul>
      </section>

      {message ? (
        <p className="text-sm" data-testid="fulfillment-message">
          {message}
        </p>
      ) : null}
    </div>
  );
}
