import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

// Cron endpoint plumbing (R-182, R-163): bearer-secret auth + a CronRunLog row
// around every run. With no CRON_SECRET configured the endpoints are disabled
// (503) — a scheduler can never run them unauthenticated by accident.

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

/** Run a job with start/finish/outcome recorded (R-163). */
export async function runCronJob<T>(jobName: string, job: () => Promise<T>): Promise<T> {
  const run = await db.cronRunLog.create({ data: { jobName } });
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
      data: { status: "failed", finishedAt: new Date(), detail: { error: (error as Error).message.slice(0, 500) } },
    });
    throw error;
  }
}
