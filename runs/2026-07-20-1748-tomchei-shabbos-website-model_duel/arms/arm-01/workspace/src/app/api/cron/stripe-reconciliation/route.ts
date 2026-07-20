import { reconcileStripePayments } from "@/domain/stripe-reconciliation";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Cron authorization failed." }, { status: 401 });
  }
  const day = new Date().toISOString().slice(0, 10);
  const runKey =
    request.headers.get("x-cron-run-key") ?? `stripe-reconciliation:${day}`;
  const run = await reconcileStripePayments(db, runKey);
  return Response.json({
    runKey: run.runKey,
    matchedCount: run.matchedCount,
    findingCount: run.findingCount,
  });
}
