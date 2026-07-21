import { requireCronAuth, runCronJob } from "@/lib/cron";
import { expireOverduePickups } from "@/lib/pickup";
import { getOpenSeason } from "@/lib/season";
import { getSetting } from "@/lib/settings";

/** Pickup-expiry cron (G-026, R-182): stamp overdue ready pickups expired. */
export async function POST(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const season = await getOpenSeason();
  if (!season) return Response.json({ ok: true, skipped: "no open season" });

  const result = await runCronJob("pickup-expiry", async () => {
    const expiryDays = await getSetting("pickup.expiry_days");
    return expireOverduePickups(season.id, expiryDays);
  });
  return Response.json({ ok: true, ...result });
}
