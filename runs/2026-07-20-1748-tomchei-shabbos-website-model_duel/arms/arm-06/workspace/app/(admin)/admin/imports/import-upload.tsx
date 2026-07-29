"use client";

import { ChangeEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

// Stage a CSV: the file is read client-side and POSTed as text — the server
// parses, validates, and stores per-row verdicts. Nothing writes to the
// domain tables at this step.
export function ImportUpload({ canCustomers, canCatalog }: { canCustomers: boolean; canCatalog: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<"CUSTOMERS" | "PRODUCTS">(canCustomers ? "CUSTOMERS" : "PRODUCTS");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setError(null);
  }

  async function stage() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const csv = await file.text();
    const result = await apiFetch<{ batchId?: string }>("/api/admin/imports", {
      method: "POST",
      body: { kind, filename: file.name, csv },
    });
    setBusy(false);
    if (!result.ok || !result.body.batchId) {
      setError(result.body.error ?? "Could not stage the import");
      return;
    }
    router.push(`/admin/imports/${result.body.batchId}`);
  }

  const columns =
    kind === "CUSTOMERS"
      ? "name, email, phone (phone optional)"
      : "name, price, description, category, active (last three optional)";

  return (
    <Card className="mt-5 max-w-2xl p-5" data-import-upload>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="import-kind">Import kind</Label>
          <Select
            id="import-kind"
            className="mt-1"
            value={kind}
            onChange={(event) => setKind(event.target.value as "CUSTOMERS" | "PRODUCTS")}
            data-import-kind
          >
            {canCustomers && <option value="CUSTOMERS">Customers</option>}
            {canCatalog && <option value="PRODUCTS">Products</option>}
          </Select>
        </div>
        <div>
          <Label htmlFor="import-file">CSV file</Label>
          <input
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            className="mt-1 text-sm"
            onChange={onFile}
            data-import-file
          />
        </div>
        <Button size="sm" onClick={stage} disabled={!file || busy} data-import-stage>
          {busy ? "Staging…" : "Stage and preview"}
        </Button>
      </div>
      <p className="mt-3 text-xs text-stone-500">
        Columns: {columns}. First row is the header. Duplicates and invalid rows are reported, never
        silently written.
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  );
}
