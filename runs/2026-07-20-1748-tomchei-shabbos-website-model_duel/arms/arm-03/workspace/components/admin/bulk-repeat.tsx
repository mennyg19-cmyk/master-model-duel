"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";

type BulkSummary = {
  customersConsidered: number;
  drafted: number;
  skippedCustomers: number;
  skippedLines: number;
  truncated: boolean;
};

/** Bulk repeat (R-058): one POS draft per customer from their latest order in a prior season. */
export function BulkRepeat({ seasons }: { seasons: { id: string; name: string }[] }) {
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? "");
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!confirm("Create a POS draft for every customer who ordered in that season?")) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const result = await apiFetch<BulkSummary>("/api/admin/repeat/bulk", {
        method: "POST",
        body: { sourceSeasonId: seasonId },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(result.body);
    } finally {
      setBusy(false);
    }
  }

  if (seasons.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardTitle className="mb-2">Bulk repeat a past season</CardTitle>
      <p className="mb-3 text-sm text-muted">
        Drafts each customer&apos;s most recent order from the chosen season into Point of sale. Customers with a POS
        draft already in progress are left alone.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={seasonId} onChange={(event) => setSeasonId(event.target.value)} aria-label="Source season">
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.name}
            </option>
          ))}
        </Select>
        <Button onClick={run} disabled={busy || !seasonId} data-testid="bulk-repeat-run">
          {busy ? "Drafting…" : "Create repeat drafts"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {summary && (
        <p className="mt-2 text-sm" data-testid="bulk-repeat-summary">
          Drafted {summary.drafted} of {summary.customersConsidered} customers
          {summary.skippedCustomers > 0 && ` · ${summary.skippedCustomers} skipped`}
          {summary.skippedLines > 0 && ` · ${summary.skippedLines} lines had nothing to map to`}
          {summary.truncated && " · more remain — run again"}
        </p>
      )}
    </Card>
  );
}
