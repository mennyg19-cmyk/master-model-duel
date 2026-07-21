import { db } from "@/lib/db";
import { LETTER, paginate, renderPdf, type PdfLine } from "@/lib/pdf";
import { renderArtifactPdf } from "@/lib/print/render";
import type { GroupArtifactPayload, PrintPackage } from "@/lib/print/payload";
import { googleMapsUrl } from "@/lib/routes/geo";
import { ActionError } from "@/lib/packages/actions";

// Route paper (R-075, R-076): the printed fallback sheet a driver can run the
// whole route from, and the per-route greeting-card stack. Rendered live from
// the route's current stops, so a reroute is on the next print automatically.

async function loadRouteWithStops(seasonId: string, routeId: string) {
  const route = await db.deliveryRoute.findFirst({
    where: { id: routeId, seasonId },
    include: {
      driverStaff: { select: { name: true } },
      stops: {
        orderBy: { position: "asc" },
        include: {
          package: {
            include: {
              fulfillmentMethod: { select: { name: true } },
              lines: { include: { product: { select: { name: true } }, addOns: { include: { addOn: { select: { name: true } } } }, order: { select: { orderNumber: true, draftReference: true } } } },
            },
          },
        },
      },
    },
  });
  if (!route) throw new ActionError("Route not found", 404);
  return route;
}

type LoadedRoute = Awaited<ReturnType<typeof loadRouteWithStops>>;

function toPrintPackage(stop: LoadedRoute["stops"][number]): PrintPackage {
  const pkg = stop.package;
  return {
    packageId: pkg.id,
    recipientName: pkg.recipientName,
    addressLine1: pkg.addressLine1,
    addressLine2: pkg.addressLine2,
    city: pkg.city,
    state: pkg.state,
    zip: pkg.zip,
    methodName: pkg.fulfillmentMethod.name,
    greeting: pkg.greeting,
    stage: pkg.stage,
    orderRefs: [...new Set(pkg.lines.map((line) => (line.order.orderNumber ? `#${line.order.orderNumber}` : line.order.draftReference)))],
    items: pkg.lines.map((line) => ({
      name: line.product.name,
      quantity: line.quantity,
      addOns: line.addOns.map((addOn) => addOn.addOn.name),
    })),
  };
}

/** Letter route sheet: stops in driving order with a Delivered checkbox each. */
export async function renderRouteSheet(seasonId: string, routeId: string): Promise<Buffer> {
  const route = await loadRouteWithStops(seasonId, routeId);
  const lines: PdfLine[] = [
    { text: `Route sheet — ${route.name}`, size: 16, bold: true },
    {
      text: `Driver: ${route.driverStaff?.name ?? "unassigned"} · ${route.stops.length} stop(s) · Printed ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      size: 9,
    },
  ];
  for (const stop of route.stops) {
    const pkg = stop.package;
    lines.push({ text: `[ ]  Stop ${stop.position} — ${pkg.recipientName}`, size: 12, bold: true, gapBefore: 14 });
    lines.push({ text: pkg.addressLine1 + (pkg.addressLine2 ? `, ${pkg.addressLine2}` : "") });
    lines.push({ text: `${pkg.city}, ${pkg.state} ${pkg.zip}` });
    const print = toPrintPackage(stop);
    for (const item of print.items) {
      lines.push({ text: `  ${item.quantity} x ${item.name}${item.addOns.length > 0 ? ` (+ ${item.addOns.join(", ")})` : ""}`, size: 9 });
    }
    lines.push({ text: `Maps: ${googleMapsUrl({ line1: pkg.addressLine1, city: pkg.city, state: pkg.state, zip: pkg.zip })}`, size: 7 });
  }
  return renderPdf(paginate(lines, LETTER), LETTER);
}

/** Per-route greeting cards (R-076): reuses the 5x7 card renderer from P7. */
export async function renderRouteGreetingCards(seasonId: string, routeId: string): Promise<Buffer> {
  const route = await loadRouteWithStops(seasonId, routeId);
  const payload: GroupArtifactPayload = {
    filingGroup: route.name,
    generatedAt: new Date().toISOString(),
    packages: route.stops.map(toPrintPackage),
  };
  return renderArtifactPdf("GREETING_CARDS", payload);
}
