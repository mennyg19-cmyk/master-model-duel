import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { listBulkHistoryCandidates } from "@/lib/repeat/bulk-history";
import { getOpenSeason } from "@/lib/seasons/queries";
import { RepeatBulkPicker } from "./repeat-bulk-picker";

export const metadata: Metadata = { title: "Bulk repeat" };
export const dynamic = "force-dynamic";

// P10 (R-058): bulk repeat of customer history — pick prior-season finalized
// orders (default: the newest closed season), confirm, drafts land on the
// customers' accounts. Idempotent: already-repeated rows are marked and the
// server skips them on a re-run.
export default async function RepeatBulkPage({
  searchParams,
}: {
  searchParams: Promise<{ seasonId?: string }>;
}) {
  await requirePermission("payments.manage");
  const { seasonId } = await searchParams;

  const openSeason = await getOpenSeason();
  if (!openSeason) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-stone-900">Bulk repeat of customer history</h2>
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          No open season — open one from Seasons before repeating history.
        </p>
      </div>
    );
  }

  const { rows, sourceSeasons } = await listBulkHistoryCandidates({ sourceSeasonId: seasonId });
  return (
    <div>
      <h2 className="text-lg font-semibold text-stone-900">Bulk repeat of customer history</h2>
      <p className="mt-1 text-sm text-stone-500">
        Repeat prior-year orders into <span className="font-medium text-stone-700">{openSeason.name}</span>.
        Replacement chains resolve automatically; discontinued lines are dropped per order and reported.
      </p>
      <RepeatBulkPicker
        rows={rows.map((row) => ({ ...row, placedAt: row.placedAt.toISOString() }))}
        sourceSeasons={sourceSeasons}
        selectedSeasonId={seasonId ?? sourceSeasons[0]?.id ?? ""}
      />
    </div>
  );
}
