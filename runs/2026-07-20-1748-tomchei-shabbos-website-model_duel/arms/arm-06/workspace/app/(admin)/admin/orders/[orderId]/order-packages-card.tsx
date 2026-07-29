"use client";

import { useState } from "react";
import Link from "next/link";
import type { PackageStage } from "@prisma/client";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { PackageStageBadge } from "@/components/admin/order-badges";

export interface OrderPackageRow {
  id: string;
  recipientName: string;
  stage: PackageStage;
  channelLabel: string;
  methodLabel: string;
  lineCount: number;
}

// UR-001: the order's materialized packages, plus the per-order packing slip
// (UR-005): a reprint scoped to this order produces a fresh batch whose slips
// PDF is the packing slip. Printing never moves package stages (G-004).
export function OrderPackagesCard({ orderId, packages }: { orderId: string; packages: OrderPackageRow[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slipBatchId, setSlipBatchId] = useState<string | null>(null);

  async function printPackingSlip() {
    setBusy(true);
    setError(null);
    setSlipBatchId(null);
    const result = await apiFetch<{ batch?: { id?: string } }>("/api/admin/fulfillment/print-batches/reprint", {
      method: "POST",
      body: { orderId },
    });
    setBusy(false);
    if (!result.ok || !result.body.batch?.id) {
      setError(result.body.error ?? "Could not create the packing slip");
      return;
    }
    setSlipBatchId(result.body.batch.id);
  }

  return (
    <Card className="p-5" data-order-packages>
      <CardTitle>Packages</CardTitle>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {packages.map((pkg) => (
          <li key={pkg.id} className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/packages/${pkg.id}`} className="font-medium text-brand-700 hover:underline">
              {pkg.recipientName}
            </Link>
            <PackageStageBadge stage={pkg.stage} />
            <span className="text-xs text-stone-500">
              {pkg.channelLabel} · {pkg.methodLabel} · {pkg.lineCount} line(s)
            </span>
          </li>
        ))}
        {packages.length === 0 && (
          <li className="text-stone-500">No packages — they materialize when the order finalizes.</li>
        )}
      </ul>
      {packages.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-stone-200 pt-3">
          <Button variant="secondary" size="sm" onClick={printPackingSlip} disabled={busy} data-packing-slip>
            {busy ? "Creating…" : "Reprint packing slip"}
          </Button>
          {slipBatchId && (
            <a
              href={`/api/admin/fulfillment/print-batches/${slipBatchId}/pdf?artifact=slips`}
              className="text-sm font-medium text-brand-700 hover:underline"
              data-packing-slip-pdf
            >
              Download packing slip PDF
            </a>
          )}
        </div>
      )}
    </Card>
  );
}
