import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { getOpenSeason } from "@/lib/season";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RouteBuilder } from "@/components/admin/route-actions";
import { BulkDeliveryForm } from "@/components/admin/bulk-delivery-form";

const STATUS_TONE = { PLANNED: "neutral", IN_PROGRESS: "brand", COMPLETED: "success" } as const;

export default async function RoutesPage() {
  await requirePermissionPage("fulfillment.manage");
  const season = await getOpenSeason();
  if (!season) {
    return <p className="text-sm text-muted">No open season — routes live inside a season.</p>;
  }

  const [routes, methods, schedules] = await Promise.all([
    db.deliveryRoute.findMany({
      where: { seasonId: season.id },
      include: {
        driverStaff: { select: { name: true } },
        stops: { select: { deliveredAt: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.fulfillmentMethod.findMany({
      where: { isActive: true, kind: { in: ["BULK_DELIVERY", "PER_PACKAGE_DELIVERY"] } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    db.bulkDeliverySchedule.findMany({
      where: { seasonId: season.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Delivery routes</h1>

      <Card>
        <CardTitle>Build a route</CardTitle>
        <p className="mb-3 text-sm text-muted">
          Takes every unassigned, undelivered package of the chosen method and orders the stops
          nearest-first from the warehouse.
        </p>
        <RouteBuilder methods={methods} />
      </Card>

      <Card>
        <CardTitle>Routes</CardTitle>
        {routes.length === 0 ? (
          <p className="text-sm text-muted">No routes yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2">Route</th>
                <th>Status</th>
                <th>Driver</th>
                <th>Stops</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => {
                const delivered = route.stops.filter((stop) => stop.deliveredAt).length;
                return (
                  <tr key={route.id} className="border-b border-border/60">
                    <td className="py-2">
                      <Link href={`/admin/routes/${route.id}`} className="text-brand-strong underline">
                        {route.name}
                      </Link>
                    </td>
                    <td><Badge tone={STATUS_TONE[route.status]}>{route.status.replace("_", " ")}</Badge></td>
                    <td>{route.driverStaff?.name ?? <span className="text-muted">unassigned</span>}</td>
                    <td>{delivered}/{route.stops.length} delivered</td>
                    <td className="text-muted">{route.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <CardTitle>Bulk delivery scheduling</CardTitle>
        <p className="mb-3 text-sm text-muted">
          Pick the drop date and window — every customer with an undelivered bulk package gets one
          email and one SMS.
        </p>
        <BulkDeliveryForm />
        {schedules.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-muted">
            {schedules.map((schedule) => (
              <li key={schedule.id}>
                {schedule.scheduledDate}, {schedule.window} — {schedule.packageCount} package(s),{" "}
                {schedule.customerCount} customer(s) notified
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
