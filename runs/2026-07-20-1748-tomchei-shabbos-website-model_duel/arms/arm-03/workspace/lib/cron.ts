import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

// Cron endpoint plumbing (R-182, R-163): bearer-secret auth + a CronRunLog row
// around every run. With no CRON_SECRET configured the endpoints are disabled
// (503) — a scheduler can never run them unauthenticated by accident.

const STALE_RUNNING_MS = 10 * 60 * 1000;

export function requireCronAuth(request: Request): Response | null {
  if (!env.CRON_SECRET) {
    return Response.json({ error: "Cron endpoints are disabled — set CRON_SECRET" }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  // Constant-time compare — same posture as the driver PIN gate.
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const actual = Buffer.from(header);
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!matches) {
    return Response.json({ error: "Missing or wrong cron bearer secret" }, { status: 401 });
  }
  return null;
}

export type CronSkip = { skipped: true; reason: "overlap" };

/**
 * Run a job with start/finish/outcome recorded (R-163). Concurrent invocations
 * of the same jobName: oldest running claim wins; others return skipped overlap
 * (M-01) so two schedulers never both mutate the same work.
 */
export async function runCronJob<T>(
  jobName: string,
  job: () => Promise<T>
): Promise<T | CronSkip> {
  const staleCutoff = new Date(Date.now() - STALE_RUNNING_MS);
  await db.cronRunLog.updateMany({
    where: { jobName, status: "running", startedAt: { lt: staleCutoff } },
    data: {
      status: "failed",
      finishedAt: new Date(),
      detail: { error: "stale running claim reaped" },
    },
  });

  const run = await db.cronRunLog.create({ data: { jobName } });
  const running = await db.cronRunLog.findMany({
    where: { jobName, status: "running" },
    orderBy: { startedAt: "asc" },
    select: { id: true },
  });
  if (running[0]?.id !== run.id) {
    await db.cronRunLog.update({
      where: { id: run.id },
      data: { status: "skipped", finishedAt: new Date(), detail: { reason: "overlap" } },
    });
    return { skipped: true, reason: "overlap" };
  }

  try {
    const detail = await job();
    await db.cronRunLog.update({
      where: { id: run.id },
      data: { status: "ok", finishedAt: new Date(), detail: detail as object },
    });
    return detail;
  } catch (error) {
    await db.cronRunLog.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        detail: { error: (error as Error).message.slice(0, 500) },
      },
    });
    throw error;
  }
}
