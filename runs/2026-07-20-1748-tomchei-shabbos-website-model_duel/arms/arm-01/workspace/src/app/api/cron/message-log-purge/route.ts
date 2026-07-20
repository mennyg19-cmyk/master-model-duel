import { purgeMessageLogs } from "@/domain/messaging";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Cron authorization failed." }, { status: 401 });
  }
  const retentionDays = Number(process.env.MESSAGE_LOG_RETENTION_DAYS ?? 90);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    return Response.json(
      { error: "MESSAGE_LOG_RETENTION_DAYS must be a positive integer." },
      { status: 500 },
    );
  }
  const day = new Date().toISOString().slice(0, 10);
  const runKey =
    request.headers.get("x-cron-run-key") ?? `message-log-purge:${day}`;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1_000);
  const run = await purgeMessageLogs(db, cutoff, runKey);
  return Response.json({
    runKey: run.runKey,
    status: run.status,
    purged: run.succeeded,
  });
}
