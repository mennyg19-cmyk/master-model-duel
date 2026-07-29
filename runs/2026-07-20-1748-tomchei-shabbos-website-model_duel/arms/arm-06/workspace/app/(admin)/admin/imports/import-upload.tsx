"use client";

import { ChangeEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type Kind = "CUSTOMERS" | "PRODUCTS" | "LEGACY_CUSTOMERS" | "LEGACY_PRODUCTS" | "LEGACY_ORDERS";

const KIND_COLUMNS: Record<Kind, string> = {
  CUSTOMERS: "name, email, phone (phone optional)",
  PRODUCTS: "name, price, description, category, active (last three optional)",
  LEGACY_CUSTOMERS: "customer_name, email, phone, address_label, line1, line2, city, region, postal_code, country",
  LEGACY_PRODUCTS: "year, product_name, price, product_type, size_text",
  LEGACY_ORDERS:
    "legacy_order_no, order_date, email, phone, customer_name, item_name, item_qty, item_unit_price, shipping_cents, total_cents, payment_method, payment_status, recipient_name, recipient_line1, recipient_city, recipient_region, recipient_postal_code, greeting",
};

// Stage a CSV: the file is read client-side and POSTed as text — the server
// parses, validates, and stores per-row verdicts. Nothing writes to the
// domain tables at this step. G-029: dry-run stages the same ledger but the
// batch can never commit — proof against a disposable database. The shared
// KIND_LABEL map arrives as a prop (the client bundle can't reach lib/imports
// server modules); the "(old system)" hint is this form's own suffix.
export function ImportUpload({
  canCustomers,
  canCatalog,
  canPayments,
  kindLabels,
  rowLimit,
}: {
  canCustomers: boolean;
  canCatalog: boolean;
  canPayments: boolean;
  kindLabels: Record<Kind, string>;
  rowLimit: number;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(canCustomers ? "CUSTOMERS" : "PRODUCTS");
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(false);
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
      body: { kind, filename: file.name, csv, dryRun },
    });
    setBusy(false);
    if (!result.ok || !result.body.batchId) {
      setError(result.body.error ?? "Could not stage the import");
      return;
    }
    router.push(`/admin/imports/${result.body.batchId}`);
  }

  const legacy = kind.startsWith("LEGACY_");
  const kindLabel = (value: Kind) => `${kindLabels[value]}${value.startsWith("LEGACY_") ? " (old system)" : ""}`;

  return (
    <Card className="mt-5 max-w-2xl p-5" data-import-upload>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="import-kind">Import kind</Label>
          <Select
            id="import-kind"
            className="mt-1"
            value={kind}
            onChange={(event) => setKind(event.target.value as Kind)}
            data-import-kind
          >
            {canCustomers && <option value="CUSTOMERS">{kindLabel("CUSTOMERS")}</option>}
            {canCatalog && <option value="PRODUCTS">{kindLabel("PRODUCTS")}</option>}
            {canCustomers && <option value="LEGACY_CUSTOMERS">{kindLabel("LEGACY_CUSTOMERS")}</option>}
            {canCatalog && <option value="LEGACY_PRODUCTS">{kindLabel("LEGACY_PRODUCTS")}</option>}
            {canPayments && <option value="LEGACY_ORDERS">{kindLabel("LEGACY_ORDERS")}</option>}
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
      {legacy && (
        <label className="mt-3 flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} data-import-dry-run />
          Dry run — stage and validate only; the batch can never commit
        </label>
      )}
      <p className="mt-3 text-xs text-stone-500">
        Columns: {KIND_COLUMNS[kind]}. First row is the header. At most {rowLimit} data rows per file. Duplicates and
        invalid rows are reported, never silently written.
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  );
}
