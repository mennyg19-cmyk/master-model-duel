"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Batch = {
  id: string;
  kind: string;
  status: string;
  summary: Record<string, number> | null;
  rows: Array<{
    id: string;
    rowNumber: number;
    status: string;
    errors: string[] | null;
    raw: Record<string, string>;
  }>;
};

export function ImportsClient() {
  const [kind, setKind] = useState<"CUSTOMERS" | "PRODUCTS">("CUSTOMERS");
  const [csvText, setCsvText] = useState(
    "displayName,email,phone\nValid Import,valid.import@tomchei.local,5551112222\nDup Import,customer@tomchei.local,5559990000\nBad Row,,not-a-phone\n",
  );
  const [batch, setBatch] = useState<Batch | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function stage() {
    setMessage(null);
    const res = await fetch("/api/admin/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, csvText, filename: "upload.csv" }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Stage failed");
      return;
    }
    setBatch(json.batch);
    setMessage(`Staged ${json.summary.total} rows (valid=${json.summary.valid}, dup=${json.summary.duplicate}, invalid=${json.summary.invalid})`);
  }

  async function commit() {
    if (!batch) return;
    setMessage(null);
    const res = await fetch("/api/admin/imports", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batchId: batch.id, commit: true }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Commit failed");
      return;
    }
    setBatch(json.batch);
    setMessage(`Committed ${json.committed}, skipped ${json.skipped}`);
  }

  return (
    <div className="space-y-4" data-testid="imports-hub">
      <div className="flex flex-wrap gap-2">
        <select
          className="rounded border px-2 py-2 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value as "CUSTOMERS" | "PRODUCTS")}
          data-testid="import-kind"
        >
          <option value="CUSTOMERS">Customers</option>
          <option value="PRODUCTS">Products</option>
        </select>
        <Button type="button" onClick={stage} data-testid="import-stage">
          Stage preview
        </Button>
        <Button type="button" variant="secondary" onClick={commit} disabled={!batch || batch.status !== "STAGED"} data-testid="import-commit">
          Atomic commit
        </Button>
      </div>
      <textarea
        className="min-h-40 w-full rounded border bg-white p-3 font-mono text-xs"
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
        data-testid="import-csv"
      />
      {message ? (
        <p className="text-sm" data-testid="import-message">
          {message}
        </p>
      ) : null}
      {batch ? (
        <div className="rounded bg-white p-4 shadow-sm" data-testid="import-preview">
          <p className="text-sm font-semibold">
            Batch {batch.id.slice(0, 8)} · {batch.status}
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {batch.rows.map((r) => (
              <li key={r.id}>
                #{r.rowNumber} {r.status}
                {r.errors?.length ? ` — ${r.errors.join("; ")}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
