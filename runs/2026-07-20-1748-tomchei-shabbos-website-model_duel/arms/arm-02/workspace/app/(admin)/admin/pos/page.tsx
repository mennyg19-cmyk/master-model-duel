import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { getOpenSeason } from "@/lib/season";
import { getBuilderCatalog } from "@/lib/order-builder/cart";
import { PosClient } from "@/components/admin/pos-client";

/** Point of sale (R-059..R-061, UR-006, UR-011): staff-side order taking. */
export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
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

  // Deep link from staff repeat (R-057): land with the customer already selected.
  const { customerId } = await searchParams;
  const initialCustomer = customerId
    ? await db.customer.findUnique({
        where: { id: customerId },
        select: { id: true, name: true, email: true, phone: true },
      })
    : null;

  const catalog = await getBuilderCatalog(season.id);
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Point of sale</h1>
      <PosClient seasonName={season.name} catalog={catalog} initialCustomer={initialCustomer} />
    </div>
  );
}
