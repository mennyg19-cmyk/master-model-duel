"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Staged CSV import UI (R-063): paste → preview (every row bucketed with a
// reason) → atomic commit. The server re-validates on commit, so this screen
// is a convenience, never the gatekeeper.

type StagedRow = {
  line: number;
  values: Record<string, string>;
  status: "valid" | "duplicate" | "invalid";
  reason: string | null;
};

type Preview = { kind: string; rows: StagedRow[]; valid: number; duplicates: number; invalid: number };

const TEMPLATES: Record<string, string> = {
  customers: "name,email,phone\nChaim Example,chaim@example.com,555-123-4567",
  products: "name,slug,category,pricecents,description\nSample Basket,sample-basket,Baskets,3600,A tasty sample",
};

export function ImportClient({ canCustomers, canProducts }: { canCustomers: boolean; canProducts: boolean }) {
  const [kind, setKind] = useState(canCustomers ? "customers" : "products");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(mode: "preview" | "commit") {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await apiFetch<Preview & { created: number; skippedDuplicates: number }>("/api/admin/import", {
        method: "POST",
        body: { kind, mode, csv },
      });
      if (!outcome.ok) {
        setError(outcome.error);
        if (mode === "commit") setPreview(null);
        return;
      }
      if (mode === "preview") {
        setPreview(outcome.body);
      } else {
        setPreview(null);
        setCsv("");
        setResult(`Imported ${outcome.body.created} new ${kind}; skipped ${outcome.body.skippedDuplicates} duplicate rows.`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-4">
      <Card>
        <CardTitle className="mb-3">1 · Paste CSV</CardTitle>
        <div className="mb-2 flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">Import</span>
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value);
                setPreview(null);
              }}
              className="rounded-md border border-border bg-white px-2 py-1 text-ink"
            >
              {canCustomers && <option value="customers">Customers</option>}
              {canProducts && <option value="products">Products (open season)</option>}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setCsv(TEMPLATES[kind])}
            className="text-brand hover:underline"
          >
            Insert template
          </button>
        </div>
        <textarea
          value={csv}
          onChange={(event) => {
            setCsv(event.target.value);
            setPreview(null);
          }}
          rows={8}
          placeholder={TEMPLATES[kind]}
          className="w-full rounded-md border border-border bg-white px-3 py-2 font-mono text-xs text-ink"
          data-testid="import-csv"
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy || !csv.trim()}
            onClick={() => call("preview")}
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
            data-testid="import-preview"
          >
            Stage &amp; preview
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        {result && <p className="mt-2 text-sm text-success">{result}</p>}
      </Card>

      {preview && (
        <Card>
          <CardTitle className="mb-3">
            2 · Review{" "}
            <span className="text-sm font-normal text-muted">
              {preview.valid} valid · {preview.duplicates} duplicate · {preview.invalid} invalid
            </span>
          </CardTitle>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-1.5 pr-3">Line</th>
                  <th className="py-1.5 pr-3">Row</th>
                  <th className="py-1.5 pr-3">Status</th>
                  <th className="py-1.5">Reason</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line} className="border-b border-border last:border-0 align-top">
                    <td className="py-1.5 pr-3 text-muted">{row.line}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs break-all">
                      {Object.values(row.values).filter(Boolean).join(" · ")}
                    </td>
                    <td className="py-1.5 pr-3">
                      <Badge tone={row.status === "valid" ? "success" : row.status === "duplicate" ? "neutral" : "danger"}>
                        {row.status}
                      </Badge>
                    </td>
                    <td className="py-1.5 text-muted">{row.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 border-t border-border pt-3">
            {preview.invalid > 0 ? (
              <p className="text-sm text-danger">
                Commit is blocked while invalid rows remain — the import is all-or-nothing. Fix the CSV and stage again.
              </p>
            ) : (
              <button
                type="button"
                disabled={busy || preview.valid === 0}
                onClick={() => call("commit")}
                className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
                data-testid="import-commit"
              >
                Commit {preview.valid} row{preview.valid === 1 ? "" : "s"}
                {preview.duplicates > 0 ? ` (skip ${preview.duplicates} duplicates)` : ""}
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
