"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";

// Package board controls (UR-001): per-row stage advance, an expandable split
// panel, and multi-select regroup. Every action round-trips through the
// version-guarded APIs and refreshes the server-rendered list.

type BoardLine = {
  id: string;
  quantity: number;
  productName: string;
  hasAddOns: boolean;
  orderId: string;
  orderRef: string;
};

export type BoardPackage = {
  id: string;
  version: number;
  stage: string;
  recipientName: string;
  address: string;
  greeting: string;
  methodName: string;
  methodKind: string;
  lines: BoardLine[];
};

const NEXT_STAGES: Record<string, string[]> = {
  NEW: ["PRINTED", "PACKED"],
  PRINTED: ["PACKED"],
  PACKED: [],
};

function stageTone(stage: string): "brand" | "neutral" | "success" {
  if (stage === "NEW") return "brand";
  if (stage === "SENT" || stage === "PICKED_UP") return "success";
  return "neutral";
}

export function PackageBoard({ packages }: { packages: BoardPackage[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [splitting, setSplitting] = useState<string | null>(null);
  const [splitQuantities, setSplitQuantities] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function run(action: () => Promise<{ ok: boolean; error?: string; note?: string }>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      setMessage(result.ok ? (result.note ?? "Done.") : result.error ?? "Something went wrong");
      if (result.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const advance = (entry: BoardPackage, to: string) =>
    run(async () => {
      const result = await apiFetch(`/api/admin/packages/${entry.id}/stage`, {
        body: { to, version: entry.version },
      });
      return result.ok
        ? { ok: true, note: `${entry.recipientName} → ${to.toLowerCase().replace("_", " ")}` }
        : { ok: false, error: result.error };
    });

  const regroup = () =>
    run(async () => {
      const result = await apiFetch("/api/admin/packages/regroup", { body: { ids: [...selected] } });
      if (result.ok) setSelected(new Set());
      return result.ok
        ? { ok: true, note: `Regrouped ${selected.size} packages into one` }
        : { ok: false, error: result.error };
    });

  const split = (entry: BoardPackage) =>
    run(async () => {
      const parts = entry.lines
        .filter((line) => (splitQuantities[line.id] ?? 0) > 0)
        .map((line) => ({ lineId: line.id, quantity: Math.min(splitQuantities[line.id], line.quantity) }));
      if (parts.length === 0) return { ok: false, error: "Set a quantity on at least one item" };
      const result = await apiFetch(`/api/admin/packages/${entry.id}/split`, { body: { parts } });
      if (result.ok) {
        setSplitting(null);
        setSplitQuantities({});
      }
      return result.ok ? { ok: true, note: "Package split — the new box is on the board" } : { ok: false, error: result.error };
    });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted">{selected.size} selected</span>
        <button
          type="button"
          disabled={busy || selected.size < 2}
          onClick={regroup}
          className="rounded-md border border-border px-3 py-1 hover:bg-brand-soft disabled:opacity-50"
        >
          Regroup selected
        </button>
        <span className="text-xs text-muted">
          Regrouping merges packages with the same recipient, address, method, and greeting.
        </span>
      </div>
      {message && (
        <p className="mb-3 rounded-md border border-border bg-brand-soft/40 p-2 text-sm" data-testid="board-message">
          {message}
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="w-8 py-2 pr-2" />
            <th className="py-2 pr-3">Recipient</th>
            <th className="py-2 pr-3">Contents</th>
            <th className="py-2 pr-3">Channel</th>
            <th className="py-2 pr-3">Stage</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((entry) => {
            const terminal = entry.methodKind === "PICKUP" ? "PICKED_UP" : "SENT";
            const nextStages = [...(NEXT_STAGES[entry.stage] ?? []), ...(entry.stage in NEXT_STAGES ? [terminal] : [])];
            const totalUnits = entry.lines.reduce((sum, line) => sum + line.quantity, 0);
            return (
              <tr key={entry.id} className="border-b border-border last:border-0 align-top">
                <td className="py-2 pr-2">
                  <input
                    type="checkbox"
                    aria-label="Select package"
                    checked={selected.has(entry.id)}
                    onChange={() => toggle(entry.id)}
                  />
                </td>
                <td className="py-2 pr-3">
                  <span className="block font-medium">{entry.recipientName}</span>
                  <span className="text-xs text-muted">{entry.address}</span>
                  {entry.greeting && <span className="block text-xs italic text-muted">“{entry.greeting}”</span>}
                </td>
                <td className="py-2 pr-3">
                  {entry.lines.map((line) => (
                    <span key={line.id} className="block">
                      {line.quantity} × {line.productName}{" "}
                      <Link href={`/admin/orders/${line.orderId}`} className="text-xs text-brand hover:underline">
                        {line.orderRef}
                      </Link>
                    </span>
                  ))}
                </td>
                <td className="py-2 pr-3">{entry.methodName}</td>
                <td className="py-2 pr-3">
                  <Badge tone={stageTone(entry.stage)}>{entry.stage.replace("_", " ")}</Badge>
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {nextStages.map((to) => (
                      <button
                        key={to}
                        type="button"
                        disabled={busy}
                        onClick={() => advance(entry, to)}
                        className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-brand-soft disabled:opacity-50"
                      >
                        Mark {to.toLowerCase().replace("_", " ")}
                      </button>
                    ))}
                    {totalUnits > 1 && entry.stage !== "SENT" && entry.stage !== "PICKED_UP" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setSplitting(splitting === entry.id ? null : entry.id);
                          setSplitQuantities({});
                        }}
                        className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-brand-soft disabled:opacity-50"
                      >
                        Split…
                      </button>
                    )}
                  </div>
                  {splitting === entry.id && (
                    <div className="mt-2 rounded-md border border-border bg-brand-soft/30 p-2 text-xs" data-testid="split-panel">
                      <p className="mb-1 font-medium">Move into a new package:</p>
                      {entry.lines.map((line) => (
                        <label key={line.id} className="mb-1 flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={line.quantity}
                            value={splitQuantities[line.id] ?? 0}
                            onChange={(event) =>
                              setSplitQuantities((current) => ({
                                ...current,
                                [line.id]: Math.max(0, Number.parseInt(event.target.value, 10) || 0),
                              }))
                            }
                            className="w-14 rounded-md border border-border bg-white px-1 py-0.5"
                          />
                          <span>
                            of {line.quantity} × {line.productName}
                            {line.hasAddOns && " (has add-ons — moves whole)"}
                          </span>
                        </label>
                      ))}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => split(entry)}
                        className="mt-1 rounded-md bg-brand px-3 py-1 font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
                      >
                        Split package
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {packages.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-muted">
                No packages match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
