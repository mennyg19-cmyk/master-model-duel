"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Batch = {
  id: string;
  kind: string;
  status: string;
  dryRun?: boolean;
  summary: Record<string, number> | null;
  rows: Array<{
    id: string;
    rowNumber: number;
    status: string;
    errors: string[] | null;
    raw: Record<string, string>;
  }>;
};

const MESSY_ORDERS = `orderNumber,email,sku,qty,recipient,line1,city,state,zip,method
ABC-broken,legacy.a@tomchei.local,CLASSIC-2025,1,Legacy A,100 Ocean Pkwy,Brooklyn,NY,11218,SHIP
900001,legacy.a@tomchei.local,CLASSIC-2025,1,Legacy A Dup,100 Ocean Pkwy,Brooklyn,NY,11218,SHIP
900002,bad-email,MISSING-SKU,1,No Product,1 Main St,Brooklyn,NY,badzip,SHIP
900003,legacy.b@tomchei.local,CLASSIC-2025,2,Legacy B,200 Ocean Pkwy,Brooklyn,NY,11218,SHIP
`;

export function ImportsClient() {
  const [kind, setKind] = useState<"CUSTOMERS" | "PRODUCTS" | "ORDERS">("CUSTOMERS");
  const [dryRun, setDryRun] = useState(false);
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
      body: JSON.stringify({ kind, csvText, filename: "upload.csv", dryRun }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Stage failed");
      return;
    }
    setBatch(json.batch);
    setMessage(
      `Staged ${json.summary.total} rows (valid=${json.summary.valid}, dup=${json.summary.duplicate}, invalid=${json.summary.invalid})${json.dryRun ? " [dry-run]" : ""}`,
    );
  }

  async function commit(maxRows?: number) {
    if (!batch) return;
    setMessage(null);
    const res = await fetch("/api/admin/imports", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batchId: batch.id, commit: true, maxRows }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Commit failed");
      return;
    }
    setBatch(json.batch);
    setMessage(
      `Committed ${json.committed}, skipped ${json.skipped}${json.interrupted ? " (interrupted — resume)" : ""}${json.dryRun ? " [dry-run]" : ""}`,
    );
  }

  return (
    <div className="space-y-4" data-testid="imports-hub">
      <div className="flex flex-wrap gap-2">
        <select
          className="rounded border px-2 py-2 text-sm"
          value={kind}
          onChange={(e) => {
            const next = e.target.value as "CUSTOMERS" | "PRODUCTS" | "ORDERS";
            setKind(next);
            if (next === "ORDERS") setCsvText(MESSY_ORDERS);
          }}
          data-testid="import-kind"
        >
          <option value="CUSTOMERS">Customers</option>
          <option value="PRODUCTS">Products</option>
          <option value="ORDERS">Historical orders</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            data-testid="import-dry-run"
          />
          Dry-run
        </label>
        <Button type="button" onClick={stage} data-testid="import-stage">
          Stage preview
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void commit()}
          disabled={!batch || (batch.status !== "STAGED" && batch.status !== "INTERRUPTED")}
          data-testid="import-commit"
        >
          Atomic commit
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void commit(1)}
          disabled={!batch || (batch.status !== "STAGED" && batch.status !== "INTERRUPTED")}
          data-testid="import-commit-one"
        >
          Commit 1 (interrupt)
        </Button>
      </div>
      <p className="text-xs opacity-70">
        Entity map: legacy customer→Customer, sku→Product, order→Order+OrderLine, address→SavedAddress
        (R-165).
      </p>
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
            {batch.dryRun ? " · dry-run" : ""}
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
