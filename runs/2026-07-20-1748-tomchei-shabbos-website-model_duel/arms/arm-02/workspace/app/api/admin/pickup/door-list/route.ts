import { requirePermissionApi } from "@/lib/auth/current-user";
import { renderDoorList } from "@/lib/pickup";
import { getOpenSeason } from "@/lib/season";

/** Printable door list of ready pickups with a picked-up stamp box (G-026). */
export async function GET() {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  const pdf = await renderDoorList(season.id);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="pickup-door-list.pdf"',
    },
  });
}
