import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getOpenSeason } from "@/lib/seasons/queries";
import { getSetting } from "@/lib/settings";
import { listRoutes } from "@/lib/routes/builder";
import { Card, CardTitle } from "@/components/ui/card";
import { RouteBuilder } from "@/app/(admin)/admin/routes/route-builder";

export const metadata: Metadata = { title: "Delivery routes" };
export const dynamic = "force-dynamic";

// R-074/R-077: the route admin list — every route with stop/delivered counts
// and link state, plus the one-tap builder for a manager-set delivery day.
export default async function AdminRoutesPage() {
  await requirePermission("fulfillment.manage");
  const openSeason = await getOpenSeason();

  if (!openSeason) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Delivery routes</h1>
        <p className="mt-4 text-sm text-stone-600">No open season.</p>
      </div>
    );
  }

  const [routes, deliveryDays] = await Promise.all([listRoutes(openSeason.id), getSetting("delivery.days")]);

  return (
    <div data-routes-page>
      <h1 className="text-2xl font-semibold">Delivery routes — {openSeason.name}</h1>

      <Card className="mt-5 p-5">
        <CardTitle>Build a route</CardTitle>
        <p className="mt-1 text-sm text-stone-600">
          Geocodes every eligible per-package-delivery package through the cache and orders the stops (Mapbox
          optimization when configured, nearest-neighbor otherwise).
        </p>
        <RouteBuilder deliveryDays={deliveryDays ?? []} />
      </Card>

      <Card className="mt-4 p-5">
        <CardTitle>Routes</CardTitle>
        <ul className="mt-3 flex flex-col gap-2 text-sm" data-route-list>
          {routes.map((route) => (
            <li key={route.id} className="flex flex-wrap items-center justify-between gap-2" data-route-row={route.id}>
              <span>
                <Link href={`/admin/routes/${route.id}`} className="font-medium text-brand-700 hover:underline">
                  {route.name}
                </Link>{" "}
                <span className="text-stone-500">
                  {route.deliveryDay ?? "no day"} · {route.status}
                </span>
              </span>
              <span className="text-xs text-stone-500">
                {route.deliveredCount}/{route.stopCount} delivered
                {route.hasLink ? " · driver link active" : " · no driver link"}
              </span>
            </li>
          ))}
          {routes.length === 0 && <li className="text-stone-500">No routes yet — build one from a delivery day above.</li>}
        </ul>
      </Card>
    </div>
  );
}
