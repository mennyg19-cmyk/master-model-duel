import { applyScheduledSeasonStatuses } from "@/domain/seasons";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Cron authorization failed." }, { status: 401 });
  }
  return Response.json({ applied: await applyScheduledSeasonStatuses(db) });
}
