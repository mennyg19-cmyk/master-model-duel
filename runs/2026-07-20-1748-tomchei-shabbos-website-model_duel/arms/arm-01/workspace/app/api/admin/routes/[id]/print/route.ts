import { adminHandler } from "@/lib/api/admin-handler";
import { renderRouteGreetingCards, renderRouteSheet } from "@/lib/routes/print";

/**
 * Route paper (R-075, R-076): ?kind=sheet is the printed driver fallback,
 * ?kind=cards the per-route greeting-card stack. Rendered from the live stop
 * list, so a reroute is included on the next print.
 */
export const GET = adminHandler<{ id: string }>({}, async ({ request, params, season }) => {
  const kind = new URL(request.url).searchParams.get("kind") ?? "sheet";
  const pdf =
    kind === "cards" ? await renderRouteGreetingCards(season.id, params.id) : await renderRouteSheet(season.id, params.id);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="route-${params.id.slice(-8)}-${kind}.pdf"`,
    },
  });
});
