import { ReportTabs } from '../reports-tabs';
import { SeasonPicker } from '../season-picker';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { requirePermission } from '@/lib/auth/staff';
import { formatDateTime } from '@/lib/core/dates';
import { EXPORT_DEFINITIONS } from '@/lib/reports/datasets';
import { readExportHistory } from '@/lib/reports/export-service';
import { readSeasonPerformance } from '@/lib/reports/season-performance';

export const dynamic = 'force-dynamic';

/**
 * The export centre (R-092).
 *
 * Five files, one season at a time, and a history of every one that has been
 * taken. The history is the point as much as the buttons are: these files are
 * donors' names, addresses and phone numbers, and "who took a copy of that, and
 * when" has to be answerable without reading the audit log line by line.
 */
export default async function ExportCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ seasonId?: string }>;
}) {
  const [params] = await Promise.all([searchParams, requirePermission('reports.view')]);

  const [seasons, history] = await Promise.all([readSeasonPerformance(), readExportHistory()]);
  const season = seasons.find((row) => row.seasonId === params.seasonId) ?? seasons[0];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Exports</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Spreadsheet files of a whole season. Every download is recorded.
        </p>
      </header>

      <ReportTabs active="/admin/reports/exports" />

      {season ? (
        <>
          <SeasonPicker
            action="/admin/reports/exports"
            seasons={seasons.map((row) => ({ id: row.seasonId, label: row.label }))}
            selectedId={season.seasonId}
          />

          <div className="grid gap-3 sm:grid-cols-2" data-testid="export-center">
            {EXPORT_DEFINITIONS.map((definition) => (
              <Card key={definition.dataset} className="flex flex-col justify-between gap-3">
                <div>
                  <CardTitle>{definition.label}</CardTitle>
                  <CardDescription>{definition.description}</CardDescription>
                </div>

                <a
                  href={`/api/admin/exports/${definition.fileSlug}?seasonId=${season.seasonId}`}
                  className="inline-flex w-fit items-center justify-center rounded-md border border-[var(--color-line)] bg-white px-3.5 py-2 text-sm font-medium hover:bg-[var(--color-surface-muted)]"
                  data-testid={`export-${definition.fileSlug}`}
                  download
                >
                  Download {season.year} CSV
                </a>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <Card>
          <CardTitle>No seasons yet</CardTitle>
          <CardDescription>There is nothing to export until a season exists.</CardDescription>
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Export history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Nothing has been exported yet.</p>
        ) : (
          <table className="w-full text-sm" data-testid="export-history">
            <thead className="text-left text-[var(--color-ink-muted)]">
              <tr>
                <th className="py-2">When</th>
                <th>File</th>
                <th>Season</th>
                <th>Who</th>
                <th className="text-right">Rows</th>
                <th className="text-right">Size</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id} className="border-t border-[var(--color-line)]">
                  <td className="py-2 text-[var(--color-ink-muted)]">{formatDateTime(row.createdAt)}</td>
                  <td>{row.dataset}</td>
                  <td>{row.season?.label ?? '—'}</td>
                  <td>{row.staff?.fullName ?? 'system'}</td>
                  <td className="text-right">{row.rowCount}</td>
                  <td className="text-right">
                    {row.completedAt === null ? 'stopped part way' : formatBytes(row.byteCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} kB`;
}
