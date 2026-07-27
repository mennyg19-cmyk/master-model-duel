import { readActiveSeason } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';
import { pdfResponse } from '@/lib/print/pdf-response';
import { isRouteArtifact } from '@/lib/routing/paths';
import { renderRouteArtifact } from '@/lib/routing/route-print';

export const dynamic = 'force-dynamic';

/** The clipboard a driver takes when the phone has no signal (R-076, UR-013). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ routeId: string; artifact: string }> },
) {
  const staff = await requirePermission('routes.manage');
  const { routeId, artifact } = await params;

  if (!isRouteArtifact(artifact)) return new Response('No such document.', { status: 404 });

  const season = await readActiveSeason();
  if (!season) return new Response('There is no season to print for.', { status: 404 });

  return pdfResponse(await renderRouteArtifact(staff, { routeId, seasonId: season.id, artifact }));
}
