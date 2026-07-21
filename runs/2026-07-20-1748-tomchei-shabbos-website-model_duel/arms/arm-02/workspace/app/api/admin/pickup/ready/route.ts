import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { sendPickupReadyNotifications } from "@/lib/pickup";
import { getOpenSeason } from "@/lib/season";

/** Sweep stock-ready pickups and send the ready notification once each (G-017). */
export async function POST() {
  const gate = await requirePermissionApi("fulfillment.manage");
  if ("response" in gate) return gate.response;

  const season = await getOpenSeason();
  if (!season) return Response.json({ error: "No open season" }, { status: 409 });

  const result = await sendPickupReadyNotifications(season.id);
  await writeAudit(gate.staff, { action: "pickup.ready_sweep", detail: result });
  return Response.json({ ok: true, ...result });
}
