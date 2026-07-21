import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { getOpenSeason } from "@/lib/season";
import { rerouteSuggestions } from "@/lib/routes/service";
import { googleMapsUrl } from "@/lib/routes/geo";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RouteMap, type MapPoint } from "@/components/admin/route-map";
import {
  DriverAssign,
  RerouteConfirmButton,
  RouteLinkPanel,
  StartRouteButton,
  StopDeliveredButton,
} from "@/components/admin/route-actions";

import { ROUTE_STATUS_TONE } from "@/lib/routes/status";

export default async function RouteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermissionPage("fulfillment.manage");
  const { id } = await params;
  const season = await getOpenSeason();
  if (!season) return <p className="text-sm text-muted">No open season.</p>;

  const route = await db.deliveryRoute.findFirst({
    where: { id, seasonId: season.id },
    include: {
      driverStaff: { select: { id: true, name: true } },
      links: { where: { revokedAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
      stops: {
        orderBy: { position: "asc" },
        include: { package: { include: { fulfillmentMethod: { select: { name: true, kind: true } } } } },
      },
    },
  });
  if (!route) notFound();

  const [drivers, suggestions] = await Promise.all([
    db.staffUser.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    route.status === "COMPLETED" ? Promise.resolve([]) : rerouteSuggestions(season.id, route.id),
  ]);

  const delivered = route.stops.filter((stop) => stop.deliveredAt).length;
  const mapPoints: MapPoint[] = route.stops
    .filter((stop) => stop.latitude !== null && stop.longitude !== null)
    .map((stop) => ({
      latitude: stop.latitude!,
      longitude: stop.longitude!,
      label: String(stop.position),
      kind: stop.deliveredAt ? ("delivered" as const) : ("stop" as const),
    }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{route.name}</h1>
        <Badge tone={ROUTE_STATUS_TONE[route.status]}>{route.status.replace("_", " ")}</Badge>
        <span className="text-sm text-muted">{delivered}/{route.stops.length} delivered</span>
        <Link href="/admin/routes" className="text-sm text-brand-strong underline">← All routes</Link>
      </div>

      <Card>
        <CardTitle>Run the route</CardTitle>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {route.status !== "COMPLETED" && <StartRouteButton routeId={route.id} />}
          <span>
            Driver: <DriverAssign routeId={route.id} drivers={drivers} currentDriverId={route.driverStaff?.id ?? null} />
          </span>
          <a href={`/api/admin/routes/${route.id}/print?kind=sheet`} target="_blank" className="rounded-md border border-border px-3 py-1.5 hover:bg-brand-soft">
            Print route sheet
          </a>
          <a href={`/api/admin/routes/${route.id}/print?kind=cards`} target="_blank" className="rounded-md border border-border px-3 py-1.5 hover:bg-brand-soft">
            Print greeting cards
          </a>
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium">Driver magic link</p>
          {route.links[0] && (
            <p className="mb-2 text-xs text-muted">
              A link is live{route.links[0].pinHash ? " (PIN protected)" : ""}
              {route.links[0].expiresAt ? ` — expires ${route.links[0].expiresAt.toISOString().slice(0, 16).replace("T", " ")}` : ""}.
              Creating a new one kills it.
            </p>
          )}
          {route.status === "COMPLETED" ? (
            <p className="text-sm text-muted">Route completed — links are expired.</p>
          ) : (
            <RouteLinkPanel routeId={route.id} />
          )}
        </div>
      </Card>

      <Card>
        <CardTitle>Map</CardTitle>
        <RouteMap points={mapPoints} />
        {suggestions.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">
              Nearby shipping packages (unshipped, within ~0.5 mile or same street)
            </p>
            <ul className="space-y-2 text-sm" data-testid="reroute-suggestions">
              {suggestions.map((suggestion) => (
                <li key={suggestion.packageId} className="flex flex-wrap items-center gap-2">
                  <span>
                    {suggestion.recipientName} — {suggestion.address}
                    <span className="text-muted">
                      {" "}
                      ({suggestion.reason === "radius" ? `${suggestion.distanceMiles} mi from stop ${suggestion.nearStopPosition}` : `same street as stop ${suggestion.nearStopPosition}`}
                      {suggestion.hasActiveLabel ? " · label will be voided" : ""})
                    </span>
                  </span>
                  <RerouteConfirmButton
                    routeId={route.id}
                    packageId={suggestion.packageId}
                    label={suggestion.recipientName}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Stops</CardTitle>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2">#</th>
              <th>Recipient</th>
              <th>Address</th>
              <th>Method</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {route.stops.map((stop) => (
              <tr key={stop.id} className="border-b border-border/60">
                <td className="py-2">{stop.position}</td>
                <td>{stop.package.recipientName}</td>
                <td>
                  <a
                    href={googleMapsUrl({ line1: stop.package.addressLine1, city: stop.package.city, state: stop.package.state, zip: stop.package.zip })}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {stop.package.addressLine1}, {stop.package.city} {stop.package.zip}
                  </a>
                </td>
                <td>{stop.package.fulfillmentMethod.name}</td>
                <td>
                  {stop.deliveredAt ? (
                    <Badge tone="success">
                      delivered {stop.deliveredAt.toISOString().slice(11, 16)} via {stop.deliveredBy?.split(":")[0]}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">pending</Badge>
                  )}
                </td>
                <td>{!stop.deliveredAt && <StopDeliveredButton routeId={route.id} stopId={stop.id} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
