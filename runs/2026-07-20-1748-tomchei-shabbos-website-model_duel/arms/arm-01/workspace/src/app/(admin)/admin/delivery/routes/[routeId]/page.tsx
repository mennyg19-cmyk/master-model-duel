import { googleMapsUrl } from "@/domain/delivery";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DeliveryRoutePage({
  params,
  searchParams,
}: {
  params: Promise<{ routeId: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  await requirePermission("admin:view");
  const { routeId } = await params;
  const { print } = await searchParams;
  const route = await db.deliveryRoute.findUniqueOrThrow({
    where: { id: routeId },
    include: {
      assignedDriver: true,
      stops: {
        orderBy: { sequence: "asc" },
        include: { package: { include: { order: true } } },
      },
      audits: { orderBy: { deliveredAt: "desc" } },
    },
  });
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  const markers = route.stops
    .map((stop) => `pin-s+7c3aed(${Number(stop.longitude)},${Number(stop.latitude)})`)
    .join(",");
  const mapUrl = token && markers
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${markers}/auto/1000x500?padding=60&access_token=${encodeURIComponent(token)}`
    : null;

  return (
    <div>
      {!print && <a className="font-bold text-[var(--brand-dark)]" href="/admin/delivery">← Delivery operations</a>}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">Route detail</p>
          <h1 className="mt-2 text-4xl font-black">{route.name}</h1>
          <p className="mt-2 text-[var(--muted)]">
            {route.status} · {route.assignedDriver?.displayName ?? "Unassigned"} · print revision {route.printRevision}
          </p>
        </div>
        {!print && <a className="rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white" href="?print=1">Printable fallback + cards</a>}
      </div>
      {mapUrl && !print && (
        // Mapbox's Static Images API is the map itself, not decorative content.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={`Map of ${route.name}`} className="mt-6 w-full rounded-3xl border border-[var(--border)]" src={mapUrl} />
      )}
      {!mapUrl && !print && (
        <p className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          Add MAPBOX_ACCESS_TOKEN to render the route map. Cached coordinates and stop links remain available.
        </p>
      )}
      <section className="mt-8">
        <h2 className="text-2xl font-black">Stops</h2>
        <div className="mt-4 grid gap-4">
          {route.stops.map((stop) => (
            <article className="break-inside-avoid rounded-2xl border border-[var(--border)] bg-white p-5" key={stop.id}>
              <div className="flex justify-between gap-4">
                <h3 className="text-xl font-black">{stop.sequence}. {stop.package.recipientName}</h3>
                <b>{stop.status}</b>
              </div>
              <p className="mt-2">{JSON.stringify(stop.package.addressSnapshot)}</p>
              <p className="mt-2 text-sm"><b>Greeting card:</b> {stop.package.greetingSnapshot || "No greeting"}</p>
              <a className="mt-3 inline-block font-bold text-[var(--brand-dark)]" href={googleMapsUrl(stop.package.addressSnapshot)} target="_blank">
                Open in Google Maps
              </a>
            </article>
          ))}
        </div>
      </section>
      <section className="mt-8">
        <h2 className="text-2xl font-black">Delivery audit</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {route.audits.length} delivered taps with route-link IDs and timestamps.
        </p>
      </section>
    </div>
  );
}
