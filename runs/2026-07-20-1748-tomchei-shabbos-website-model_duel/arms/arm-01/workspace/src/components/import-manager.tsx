"use client";

import { useState } from "react";

type ImportPreview = {
  id: string;
  entityType: string;
  status: string;
  sourceName: string;
  validRowCount: number;
  invalidRowCount: number;
  duplicateCount: number;
  errors: { rowNumber: number; code: string; message: string }[];
};

export function ImportManager({ initialBatches }: { initialBatches: ImportPreview[] }) {
  const [entityType, setEntityType] = useState<"customers" | "products">("customers");
  const [csv, setCsv] = useState("displayName,email,phone\nExample Person,person@example.test,732-555-0101");
  const [batches, setBatches] = useState(initialBatches);
  const [message, setMessage] = useState("");

  async function stage(formData: FormData) {
    const response = await fetch("/api/admin/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entityType,
        sourceName: formData.get("sourceName"),
        csv,
      }),
    });
    const payload = await response.json();
    setMessage(response.ok ? "Preview staged. Review every issue before commit." : payload.error);
    if (response.ok) {
      setBatches((current) => [payload.batch, ...current]);
    }
  }

  async function commit(batchId: string) {
    const response = await fetch(`/api/admin/imports/${batchId}/commit`, { method: "POST" });
    const payload = await response.json();
    setMessage(response.ok ? `${payload.importedCount} rows committed atomically.` : payload.error);
    if (response.ok) {
      setBatches((current) =>
        current.map((batch) =>
          batch.id === batchId ? { ...batch, status: "COMMITTED" } : batch,
        ),
      );
    }
  }

  return (
    <div>
      <form action={stage} className="mt-7 rounded-3xl border border-[var(--border)] bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="font-bold">Entity
            <select className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2" onChange={(event) => {
              const next = event.target.value as "customers" | "products";
              setEntityType(next);
              setCsv(next === "customers" ? "displayName,email,phone\nExample Person,person@example.test,732-555-0101" : "sku,name,priceCents,category\nNEW-BOX,New Gift Box,4500,Gifts");
            }} value={entityType}>
              <option value="customers">Customers</option><option value="products">Products</option>
            </select>
          </label>
          <label className="font-bold">Source name
            <input className="mt-2 w-full rounded-xl border border-[var(--border)] px-3 py-2" name="sourceName" placeholder="customers-july.csv" required />
          </label>
        </div>
        <label className="mt-4 block font-bold">CSV contents
          <textarea className="mt-2 min-h-48 w-full rounded-xl border border-[var(--border)] p-3 font-mono text-sm" onChange={(event) => setCsv(event.target.value)} value={csv} />
        </label>
        <button className="mt-4 rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white">Stage preview</button>
      </form>
      {message && <p aria-live="polite" className="mt-4 rounded-xl bg-[var(--brand-soft)] p-4 font-semibold">{message}</p>}
      <div className="mt-7 space-y-4">
        {batches.map((batch) => (
          <article className="rounded-2xl border border-[var(--border)] bg-white p-5" key={batch.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><h2 className="font-bold">{batch.sourceName}</h2><p className="text-sm text-[var(--muted)]">{batch.entityType} · {batch.status}</p></div>
              <p className="text-sm font-semibold">{batch.validRowCount} valid · {batch.invalidRowCount} invalid · {batch.duplicateCount} duplicate</p>
            </div>
            {batch.errors.length > 0 && <ul className="mt-4 space-y-1 rounded-xl bg-red-50 p-4 text-sm text-red-900">{batch.errors.map((issue, index) => <li key={`${issue.rowNumber}-${index}`}>Row {issue.rowNumber}: {issue.message}</li>)}</ul>}
            {batch.status === "STAGED" && !batch.invalidRowCount && !batch.duplicateCount && (
              <button className="mt-4 rounded-xl border border-[var(--brand)] px-4 py-2 font-bold text-[var(--brand)]" onClick={() => void commit(batch.id)} type="button">Commit atomically</button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
