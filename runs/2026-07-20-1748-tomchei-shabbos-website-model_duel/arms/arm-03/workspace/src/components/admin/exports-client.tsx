"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const DATASETS = [
  "DELIVERIES",
  "YEAR_END",
  "YEAR_METRICS",
  "ITEM_SALES",
  "LAPSED_CUSTOMERS",
  "SHIPPING_MARGIN",
] as const;

type HistoryRow = {
  id: string;
  dataset: string;
  rowCount: number;
  byteCount: number;
  checksum: string;
  createdAt: string;
  staff: { displayName: string } | null;
};

export function ExportsClient() {
  const [dataset, setDataset] = useState<(typeof DATASETS)[number]>("DELIVERIES");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function loadHistory() {
    const res = await fetch("/api/admin/exports");
    const json = await res.json();
    if (res.ok) setHistory(json.history ?? []);
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  async function runExport() {
    setMessage(null);
    const res = await fetch("/api/admin/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setMessage(json.error || `Export failed (${res.status})`);
      return;
    }
    const csv = await res.text();
    const auditId = res.headers.get("x-export-audit-id");
    const rows = res.headers.get("x-export-row-count");
    setMessage(
      `Exported ${dataset}: ${rows} rows · ${csv.length} bytes · audit ${auditId?.slice(0, 8)}`,
    );
    await loadHistory();
  }

  return (
    <div className="space-y-4" data-testid="exports-hub">
      <div className="flex flex-wrap gap-2">
        <select
          className="rounded border px-2 py-2 text-sm"
          value={dataset}
          onChange={(e) => setDataset(e.target.value as (typeof DATASETS)[number])}
          data-testid="export-dataset"
        >
          {DATASETS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <Button type="button" onClick={() => void runExport()} data-testid="export-run">
          Run CSV export
        </Button>
      </div>
      {message ? (
        <p className="text-sm" data-testid="export-message">
          {message}
        </p>
      ) : null}
      <ul className="space-y-2" data-testid="export-history">
        {history.map((h) => (
          <li key={h.id} className="rounded bg-white p-3 text-xs shadow-sm">
            {h.dataset} · {h.rowCount} rows · {h.byteCount}b · {h.staff?.displayName ?? "—"} ·{" "}
            {new Date(h.createdAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}
