import { readActiveSeason } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';
import { isPrintArtifact } from '@/lib/print/documents';
import { pdfResponse } from '@/lib/print/pdf-response';
import { renderOrderArtifact } from '@/lib/print/print-render';

export const dynamic = 'force-dynamic';

/** R-056. One order's own paper, without waiting for tonight's batch. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string; artifact: string }> },
) {
  const staff = await requirePermission('fulfillment.manage');
  const { orderId, artifact } = await params;

  if (!isPrintArtifact(artifact)) return new Response('No such document.', { status: 404 });

  const season = await readActiveSeason();
  if (!season) return new Response('There is no season to print for.', { status: 404 });

  return pdfResponse(await renderOrderArtifact(staff, { orderId, seasonId: season.id, artifact }));
}
