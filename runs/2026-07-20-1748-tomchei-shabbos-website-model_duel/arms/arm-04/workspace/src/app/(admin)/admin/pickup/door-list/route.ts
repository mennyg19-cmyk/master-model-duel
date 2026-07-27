import { readActiveSeason } from '@/lib/admin/dashboard';
import { requirePermission } from '@/lib/auth/staff';
import { renderPickupDoorList } from '@/lib/pickup/pickup-print';
import { pdfResponse } from '@/lib/print/pdf-response';

export const dynamic = 'force-dynamic';

/** What the person on the door ticks off as families arrive (UR-010). */
export async function GET() {
  const staff = await requirePermission('fulfillment.manage');

  const season = await readActiveSeason();
  if (!season) return new Response('There is no season to print for.', { status: 404 });

  return pdfResponse(
    await renderPickupDoorList(staff, { seasonId: season.id, seasonLabel: season.label }),
  );
}
