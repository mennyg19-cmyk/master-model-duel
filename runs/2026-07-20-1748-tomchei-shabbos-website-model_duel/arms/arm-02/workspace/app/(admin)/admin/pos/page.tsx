import { requirePermissionPage } from "@/lib/auth/current-user";
import { getOpenSeason } from "@/lib/season";
import { getBuilderCatalog } from "@/lib/order-builder/cart";
import { PosClient } from "@/components/admin/pos-client";

/** Point of sale (R-059..R-061, UR-006, UR-011): staff-side order taking. */
export default async function PosPage() {
  await requirePermissionPage("orders.manage");
  const season = await getOpenSeason();

  if (!season) {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Point of sale</h1>
        <p className="text-sm text-muted">
          No season is open — POS orders need an open season. Open one under Settings → Seasons.
        </p>
      </div>
    );
  }

  const catalog = await getBuilderCatalog(season.id);
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Point of sale</h1>
      <PosClient seasonName={season.name} catalog={catalog} />
    </div>
  );
}
