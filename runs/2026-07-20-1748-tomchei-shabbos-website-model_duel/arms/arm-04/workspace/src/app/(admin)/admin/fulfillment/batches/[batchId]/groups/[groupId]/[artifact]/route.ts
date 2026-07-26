import { readActiveSeason } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';
import { isPrintArtifact } from '@/lib/print/documents';
import { pdfResponse } from '@/lib/print/pdf-response';
import { renderGroupArtifact } from '@/lib/print/print-render';

export const dynamic = 'force-dynamic';

/** One filing group's slips, labels or cards, rendered from what the batch froze. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string; groupId: string; artifact: string }> },
) {
  const staff = await requirePermission('fulfillment.manage');
  const { batchId, groupId, artifact } = await params;

  if (!isPrintArtifact(artifact)) return new Response('No such document.', { status: 404 });

  const season = await readActiveSeason();
  if (!season) return new Response('There is no season to print for.', { status: 404 });

  return pdfResponse(
    await renderGroupArtifact(staff, { batchId, groupId, seasonId: season.id, artifact }),
  );
}
