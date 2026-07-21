import { db } from "@/lib/db";
import { resolveDriverAccess } from "@/lib/routes/driver-access";
import { googleMapsUrl } from "@/lib/routes/geo";
import { DriverPinForm, DriverRouteActions } from "@/components/driver/route-client";

// The driver's mobile route page (UR-004, G-025). Public URL — the token IS
// the credential; scoping to one route's stops happens in resolveDriverAccess.

export default async function DriverRoutePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const access = await resolveDriverAccess(token);

  if (!access.ok && (access.reason === "not_found" || access.reason === "expired")) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-xl font-semibold">This delivery link is no longer active</h1>
        <p className="mt-2 text-sm text-muted">
          {access.reason === "expired"
            ? "The route was completed, so the link expired."
            : "Ask the office for a fresh link."}
        </p>
      </main>
    );
  }

  if (!access.ok) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-semibold">Enter your PIN</h1>
        <p className="mt-1 text-sm text-muted">The office texted you a 4-digit PIN for this route.</p>
        <DriverPinForm token={token} />
      </main>
    );
  }

  const stops = await db.routeStop.findMany({
    where: { routeId: access.route.id },
    orderBy: { position: "asc" },
    include: {
      package: {
        include: {
          lines: { include: { product: { select: { name: true } } } },
        },
      },
    },
  });
  const remaining = stops.filter((stop) => !stop.deliveredAt).length;

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold">{access.route.name}</h1>
        <p className="text-sm text-muted">
          {stops.length} stop(s) · {remaining} to go
          {access.route.status === "COMPLETED" && " · route completed"}
        </p>
      </header>

      <DriverRouteActions
        token={token}
        routeStatus={access.route.status}
        stops={stops.map((stop) => ({
          id: stop.id,
          position: stop.position,
          recipientName: stop.package.recipientName,
          addressText: `${stop.package.addressLine1}${stop.package.addressLine2 ? `, ${stop.package.addressLine2}` : ""}, ${stop.package.city}, ${stop.package.state} ${stop.package.zip}`,
          mapsUrl: googleMapsUrl({
            line1: stop.package.addressLine1,
            city: stop.package.city,
            state: stop.package.state,
            zip: stop.package.zip,
          }),
          items: stop.package.lines.map((line) => `${line.quantity} x ${line.product.name}`),
          delivered: stop.deliveredAt !== null,
        }))}
      />
    </main>
  );
}
