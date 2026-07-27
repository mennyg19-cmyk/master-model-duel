import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import { findExportDefinition } from '@/lib/reports/datasets';
import { csvExportResponse } from '@/lib/reports/export-service';

export const dynamic = 'force-dynamic';

/**
 * Downloading one of the export files (R-092).
 *
 * A route rather than a server action because the answer is a file: an action
 * would have to build the whole CSV, hand it back as a string and have the
 * browser save it, which is exactly the in-memory copy the streaming writer
 * exists to avoid.
 *
 * The permission check is the same one the export centre uses, so a guessed URL
 * is worth nothing without it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const staff = await requirePermission('reports.view');
  const definition = findExportDefinition((await params).slug);

  if (!definition) return new Response('No such export.', { status: 404 });

  const seasonId = new URL(request.url).searchParams.get('seasonId') ?? '';
  const season = await db.season.findUnique({ where: { id: seasonId } });

  if (!season) return new Response('Choose a season to export.', { status: 400 });

  return csvExportResponse(definition, season, staff);
}
