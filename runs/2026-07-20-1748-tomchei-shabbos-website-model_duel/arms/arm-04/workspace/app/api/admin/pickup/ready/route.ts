import { adminHandler } from "@/lib/api/admin-handler";
import { writeAudit } from "@/lib/audit";
import { sendPickupReadyNotifications } from "@/lib/pickup";

/** Sweep stock-ready pickups and send the ready notification once each (G-017). */
export const POST = adminHandler({}, async ({ staff, season }) => {
  const result = await sendPickupReadyNotifications(season.id);
  await writeAudit(staff, { action: "pickup.ready_sweep", detail: result });
  return Response.json({ ok: true, ...result });
});
