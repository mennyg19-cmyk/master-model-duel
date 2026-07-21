import { requirePermissionApi } from "@/lib/auth/current-user";
import { ActionError } from "@/lib/packages/actions";
import { renderRouteGreetingCards, renderRouteSheet } from "@/lib/routes/print";
import { getOpenSeason } from "@/lib/season";

/**
 * Route paper (R-075, R-076): ?kind=sheet is the printed driver fallback,
 * ?kind=cards the per-route greeting-card stack. Rendered from the live stop
 * list, so a reroute is included on the next print.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;
  const { id } = await context.params;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  const kind = new URL(request.url).searchParams.get("kind") ?? "sheet";
  try {
    const pdf = kind === "cards" ? await renderRouteGreetingCards(season.id, id) : await renderRouteSheet(season.id, id);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="route-${id.slice(-8)}-${kind}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof ActionError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
