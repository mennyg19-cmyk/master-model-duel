import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { EXPORT_DATASET_LIST } from "@/lib/exports/datasets";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Export center" };
export const dynamic = "force-dynamic";

const HISTORY_TAKE = 25;

// R-092: CSV export center + audit history. Each dataset card links the
// streamed download; the history table is the AuditLog export_csv trail.
export default async function AdminExportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStaff();
  const params = await searchParams;
  const seasonParam = typeof params.season === "string" ? params.season : undefined;

  const [seasons, openSeason, history] = await Promise.all([
    prisma.season.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    prisma.season.findFirst({ where: { status: "OPEN" } }),
    prisma.auditLog.findMany({
      where: { action: "export_csv" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_TAKE,
    }),
  ]);
  const selectedSeason = seasonParam ?? openSeason?.id ?? seasons[0]?.id;

  const visible = EXPORT_DATASET_LIST.filter((dataset) => hasPermission(ctx.staff, dataset.permission));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Export center</h1>
      <p className="mt-1 text-sm text-stone-500">
        Streamed CSV downloads — large seasons never buffer in memory. Every download is audited below.
      </p>

      <form method="get" className="mt-4 flex items-center gap-2 text-sm">
        <label htmlFor="season" className="text-stone-600">Season</label>
        <select id="season" name="season" defaultValue={selectedSeason} className="rounded-md border border-stone-300 px-2 py-1.5">
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.name}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-stone-300 px-3 py-1.5 hover:border-brand-300">
          Apply
        </button>
      </form>

      <section className="mt-6 grid gap-3 md:grid-cols-2" data-export-datasets>
        {visible.map((dataset) => (
          <div key={dataset.key} className="rounded-md border border-stone-200 bg-white p-4" data-export-card={dataset.key}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-stone-900">{dataset.label}</h2>
              <Badge tone="stone">{dataset.permission}</Badge>
            </div>
            <p className="mt-1 text-sm text-stone-500">{dataset.description}</p>
            <a
              href={`/api/admin/export/${dataset.key}${dataset.seasonScoped && selectedSeason ? `?season=${selectedSeason}` : ""}`}
              className="mt-3 inline-block rounded-md bg-brand-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
              data-export-link={dataset.key}
            >
              Download CSV
            </a>
          </div>
        ))}
        {visible.length === 0 && <p className="text-sm text-stone-500">No export datasets available for your permissions.</p>}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Export history</h2>
        <table className="mt-3 w-full border-collapse text-sm" data-export-history>
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="py-2 pr-4">When</th>
              <th className="py-2 pr-4">Dataset</th>
              <th className="py-2 pr-4">Actor</th>
              <th className="py-2 pr-4 text-right">Rows</th>
              <th className="py-2 pr-4">File</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => {
              const meta = (entry.metadata ?? {}) as { dataset?: string; rows?: number; filename?: string };
              return (
                <tr key={entry.id} className="border-b border-stone-100" data-export-history-row={meta.dataset ?? entry.targetId ?? ""}>
                  <td className="py-2 pr-4 text-stone-600">{entry.createdAt.toISOString().replace("T", " ").slice(0, 16)}</td>
                  <td className="py-2 pr-4 font-medium text-stone-900">{meta.dataset ?? entry.targetId}</td>
                  <td className="py-2 pr-4">{entry.actorEmail ?? "system"}</td>
                  <td className="py-2 pr-4 text-right">{meta.rows ?? "—"}</td>
                  <td className="py-2 pr-4 text-xs text-stone-500">{meta.filename ?? ""}</td>
                </tr>
              );
            })}
            {history.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-stone-500">
                  No exports yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
