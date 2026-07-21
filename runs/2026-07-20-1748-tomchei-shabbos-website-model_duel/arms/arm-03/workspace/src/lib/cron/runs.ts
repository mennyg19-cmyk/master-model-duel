import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { Prisma } from "@prisma/client";

/** Claim a cron sweep slot; overlapping calls with same token collide on unique (R-163). */
export async function beginCronRun(jobKey: string, claimedToken?: string) {
  const token = claimedToken ?? `${jobKey}:${randomBytes(12).toString("hex")}`;
  try {
    const row = await db.cronJobRun.create({
      data: { jobKey, claimedToken: token },
    });
    return { claimed: true as const, run: row, token };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { claimed: false as const, token };
    }
    throw error;
  }
}

export async function finishCronRun(
  runId: string,
  result: { ok: boolean; meta?: Prisma.InputJsonValue },
) {
  return db.cronJobRun.update({
    where: { id: runId },
    data: {
      finishedAt: new Date(),
      ok: result.ok,
      meta: result.meta ?? Prisma.JsonNull,
    },
  });
}

export async function writeCronAudit(
  action:
    | "NOTIFICATION_SENT"
    | "NOTIFICATION_FAILED"
    | "EMAIL_LOG_PURGED"
    | "EMAIL_CAMPAIGN_SENT"
    | "EMAIL_TEST_SENT",
  meta: Prisma.InputJsonValue,
) {
  await writeAudit({ action, meta });
}
