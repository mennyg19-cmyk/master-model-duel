import { runOutboxSweep } from "@/domain/messaging";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Cron authorization failed." }, { status: 401 });
  }
  const minute = new Date().toISOString().slice(0, 16);
  const runKey =
    request.headers.get("x-cron-run-key") ?? `message-outbox:${minute}`;
  const run = await runOutboxSweep(db, runKey);
  return Response.json({
    runKey: run.runKey,
    status: run.status,
    claimed: run.claimed,
    succeeded: run.succeeded,
    failed: run.failed,
  });
}
