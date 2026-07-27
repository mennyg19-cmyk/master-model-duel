import 'server-only';

import { recordAudit } from '../audit';
import type { StaffContext } from '../auth/staff';
import { db } from '../db';
import { csvRow } from './csv-write';
import type { ExportDefinition } from './datasets';

/**
 * How a CSV leaves the building (R-092).
 *
 * Streamed a page at a time rather than assembled and sent. The deliveries file
 * for a real Purim is five thousand rows of names and addresses, and building
 * that string in memory to hand it over in one piece is the kind of export that
 * works in development and takes the server down in the week it is needed.
 *
 * Two records are written, on purpose, and they are not the same record.
 * `ExportLog` is the export history the centre displays and the only thing that
 * can answer "which files went out this week and how big were they" as a query.
 * The audit row is what an auditor reading the security trail sees, alongside
 * every other action taken by a person. Neither one is derivable from the other.
 *
 * Both are written **before** the first byte leaves, because the point of them
 * is that somebody took a copy of every donor's address, and a download the
 * browser abandoned after the first page took a copy of part of it. The row is
 * then amended with what actually went out: an export with no `completedAt` is
 * one that stopped part way, which the centre says rather than hides.
 */
const PAGE_SIZE = 500;

export type ExportTarget = { id: string; label: string; year: number };

export async function csvExportResponse(
  definition: ExportDefinition,
  season: ExportTarget,
  staff: StaffContext,
): Promise<Response> {
  const rowCount = await definition.count(season.id);
  const logId = await beginExport(definition, season, staff, rowCount);
  const encoder = new TextEncoder();
  let byteCount = 0;
  let sentRowCount = 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (text: string) => {
        const bytes = encoder.encode(text);
        byteCount += bytes.byteLength;
        controller.enqueue(bytes);
      };

      try {
        push(csvRow(definition.headers));

        for (let skip = 0; skip < rowCount; skip += PAGE_SIZE) {
          const rows = await definition.page(season.id, skip, PAGE_SIZE);
          if (rows.length === 0) break;
          push(rows.map(csvRow).join(''));
          sentRowCount += rows.length;
        }

        await finishExport(logId, sentRowCount, byteCount);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileNameFor(definition, season)}"`,
      'cache-control': 'no-store',
    },
  });
}

export function fileNameFor(definition: ExportDefinition, season: ExportTarget): string {
  return `${definition.fileSlug}-${season.year}.csv`;
}

async function beginExport(
  definition: ExportDefinition,
  season: ExportTarget,
  staff: StaffContext,
  rowCount: number,
): Promise<string> {
  const logged = await db.exportLog.create({
    data: {
      dataset: definition.dataset,
      seasonId: season.id,
      rowCount,
      byteCount: 0,
      staffUserId: staff.acting.id,
    },
  });

  await recordAudit(staff, {
    action: 'report.exported',
    entityType: 'ExportLog',
    entityId: logged.id,
    detail: { dataset: definition.dataset, seasonYear: season.year, rowCount },
  });

  return logged.id;
}

async function finishExport(logId: string, rowCount: number, byteCount: number): Promise<void> {
  await db.exportLog.update({
    where: { id: logId },
    data: { rowCount, byteCount, completedAt: new Date() },
  });
}

export function readExportHistory(take = 20) {
  return db.exportLog.findMany({
    include: {
      staff: { select: { fullName: true } },
      season: { select: { label: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  });
}
