import { requirePermissionPage } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { getOpenSeason } from "@/lib/season";
import { EXPORT_DATASETS } from "@/lib/exports";
import { Card, CardTitle } from "@/components/ui/card";
import { ReconPanel } from "@/components/admin/recon-panel";

// CSV export center + audit history + Stripe reconciliation (R-092, R-093).

export default async function ExportsPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  await requirePermissionPage("reports.view");
  const { season: seasonParam } = await searchParams;

  const [seasons, openSeason, history, flags] = await Promise.all([
    db.season.findMany({ orderBy: { createdAt: "desc" } }),
    getOpenSeason(),
    db.auditLog.findMany({
      where: { action: "export.run" },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    db.paymentReconFlag.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100 }),
  ]);
  const selectedSeasonId = seasonParam ?? openSeason?.id ?? seasons[0]?.id ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Export center</h1>
        <p className="text-sm text-muted">
          Every download is audited below. Season scope: pick a season with the links, then export.
        </p>
      </div>

      <Card>
        <CardTitle>Datasets</CardTitle>
        <div className="mb-3 flex flex-wrap gap-2 text-sm" data-testid="export-season-picker">
          {seasons.map((season) => (
            <a
              key={season.id}
              href={`/admin/exports?season=${season.id}`}
              className={`rounded-md border px-2 py-1 ${season.id === selectedSeasonId ? "border-brand bg-brand-soft" : "border-border"}`}
            >
              {season.name}
            </a>
          ))}
        </div>
        <ul className="space-y-2">
          {Object.entries(EXPORT_DATASETS).map(([dataset, description]) => (
            <li key={dataset} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2">
              <span className="text-sm">{description}</span>
              <a
                data-testid={`export-${dataset}`}
                href={`/api/admin/exports/${dataset}?season=${selectedSeasonId}`}
                className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong"
              >
                Download CSV
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <Card data-testid="recon-card">
        <CardTitle>Stripe payment reconciliation</CardTitle>
        <p className="text-sm text-muted mb-3">
          Compares Stripe checkout sessions and intents against the posted payment ledger. Also runs
          nightly via the <code>stripe-reconciliation</code> cron. Reruns never duplicate flags.
        </p>
        <ReconPanel
          flags={flags.map((flag) => ({
            id: flag.id,
            kind: flag.kind,
            reference: flag.reference,
            status: flag.status,
            detail: (flag.detail ?? {}) as Record<string, unknown>,
            createdAt: flag.createdAt.toISOString(),
          }))}
        />
      </Card>

      <Card data-testid="export-history">
        <CardTitle>Export audit history</CardTitle>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="py-1 pr-2">When</th>
              <th className="py-1 pr-2">Who</th>
              <th className="py-1 pr-2">Dataset</th>
              <th className="py-1">Rows</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr><td colSpan={4} className="py-2 text-muted">No exports yet.</td></tr>
            )}
            {history.map((entry) => (
              <tr key={entry.id} className="border-b border-border/60">
                <td className="py-1 pr-2">{entry.createdAt.toLocaleString()}</td>
                <td className="py-1 pr-2">{entry.actorEmail}</td>
                <td className="py-1 pr-2 font-medium">{entry.targetId}</td>
                <td className="py-1">{String((entry.detail as { rows?: number } | null)?.rows ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
