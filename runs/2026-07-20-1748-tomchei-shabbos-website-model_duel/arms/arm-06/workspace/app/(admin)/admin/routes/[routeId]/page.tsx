import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { listRoutes, loadRouteDetail } from "@/lib/routes/builder";
import { oneLineAddress } from "@/lib/routes/geo";
import { formatBatchTimestamp } from "@/lib/packages/fulfillment";
import { NotFoundError } from "@/lib/errors";
import { Card, CardTitle } from "@/components/ui/card";
import { BackLink } from "@/components/admin/back-link";
import { PackageStageBadge } from "@/components/admin/order-badges";
import { RouteActions } from "@/app/(admin)/admin/routes/[routeId]/route-actions";

export const metadata: Metadata = { title: "Route detail" };
export const dynamic = "force-dynamic";

// R-077: one route — seq-ordered stops with delivery state, the driver-link
// panel (raw URL shown once at creation), reassign between PLANNED routes,
// manager-confirmed reroute suggestions, the manifest/cards prints, and the
// route event trail (the audit tap in readable form).
export default async function AdminRouteDetailPage({ params }: { params: Promise<{ routeId: string }> }) {
  await requirePermission("fulfillment.manage");
  const { routeId } = await params;

  const route = await loadRouteDetail(routeId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const siblingRoutes = (await listRoutes(route.seasonId)).filter(
    (candidate) => candidate.id !== route.id && candidate.status === "PLANNED",
  );

  return (
    <div data-route-detail={route.id}>
      <BackLink href="/admin/routes" label="All routes" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold" data-route-heading>{route.name}</h1>
        <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-800">{route.status}</span>
        <span className="text-sm text-stone-500">{route.deliveryDay ?? "no delivery day"}</span>
      </div>
      <p className="mt-1 text-sm text-stone-500">
        {route.stops.length} stop(s) · {route.stops.filter((stop) => stop.deliveredAt !== null).length} delivered
        {route.startedAt ? ` · started ${formatBatchTimestamp(route.startedAt)}` : ""}
        {route.completedAt ? ` · completed ${formatBatchTimestamp(route.completedAt)}` : ""}
      </p>

      <RouteActions
        routeId={route.id}
        routeStatus={route.status}
        link={
          route.link
            ? { expiresAt: route.link.expiresAt.toISOString(), hasPin: route.link.pinHash !== null }
            : null
        }
        stops={route.stops.map((stop) => ({ id: stop.id, seq: stop.seq, recipientName: stop.recipientName }))}
        reassignTargets={siblingRoutes.map((candidate) => ({ id: candidate.id, name: candidate.name }))}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <CardTitle>Stops</CardTitle>
          <ul className="mt-3 flex flex-col gap-3 text-sm" data-route-stops>
            {route.stops.map((stop) => (
              <li key={stop.id} className="border-b border-stone-100 pb-2 last:border-none" data-stop-row={stop.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    #{stop.seq} {stop.recipientName}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-stone-500">
                    <PackageStageBadge stage={stop.package.stage} />
                    {stop.deliveredAt ? <span data-stop-delivered>DELIVERED {formatBatchTimestamp(stop.deliveredAt)}</span> : null}
                  </span>
                </div>
                <p className="text-stone-600">
                  {oneLineAddress({
                    line1: stop.addressLine1,
                    line2: stop.addressLine2,
                    city: stop.city,
                    region: stop.region,
                    postalCode: stop.postalCode,
                  })}
                </p>
                <p className="text-xs text-stone-500">
                  Order {stop.package.order.wireFormat ?? stop.package.order.orderNumber ?? stop.package.order.id} ·{" "}
                  {stop.package.order.customer.name}
                  {stop.package.greeting ? " · greeting card" : ""}
                </p>
              </li>
            ))}
            {route.stops.length === 0 && <li className="text-stone-500">No stops on this route.</li>}
          </ul>
          <p className="mt-4 flex gap-3 text-sm">
            <a href={`/api/admin/routes/${route.id}/print.pdf`} className="font-medium text-brand-700 hover:underline" data-route-print>
              Print manifest
            </a>
            <a href={`/api/admin/routes/${route.id}/cards.pdf`} className="font-medium text-brand-700 hover:underline" data-route-cards>
              Greeting cards PDF
            </a>
          </p>
        </Card>

        <Card className="p-5">
          <CardTitle>Route events</CardTitle>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm" data-route-events>
            {route.events.map((event) => (
              <li key={event.id} className="flex flex-wrap gap-x-3 text-stone-700">
                <span className="text-xs text-stone-500">{formatBatchTimestamp(event.createdAt)}</span>
                <span className="font-medium">{event.action}</span>
              </li>
            ))}
            {route.events.length === 0 && <li className="text-stone-500">No events yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
