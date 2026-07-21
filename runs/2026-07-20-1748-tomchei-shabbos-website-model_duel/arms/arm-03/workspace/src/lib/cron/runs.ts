import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/** Shared slot for Vercel Cron (no ?token=). Released on finish so the next tick can claim. */
function inflightToken(jobKey: string) {
  return `${jobKey}:inflight`;
}

const INFLIGHT_STALE_MS = 1000 * 60 * 10;

/**
 * Claim a cron sweep slot.
 * - Explicit `claimedToken` (smoke): unique forever → sequential reuse skips as overlap.
 * - No token (Vercel): uses `${jobKey}:inflight` so overlapping production calls collide.
 */
export async function beginCronRun(jobKey: string, claimedToken?: string) {
  const token = claimedToken ?? inflightToken(jobKey);

  // Reap a crashed holder of the production inflight slot so the next tick is not stuck.
  if (!claimedToken) {
    const stale = await db.cronJobRun.findFirst({
      where: {
        claimedToken: token,
        finishedAt: null,
        startedAt: { lt: new Date(Date.now() - INFLIGHT_STALE_MS) },
      },
    });
    if (stale) {
      await finishCronRun(stale.id, {
        ok: false,
        meta: { reason: "stale_inflight_reaper" },
      });
    }
  }

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
  const run = await db.cronJobRun.findUnique({ where: { id: runId } });
  const releaseInflight =
    run != null && run.claimedToken === inflightToken(run.jobKey);

  return db.cronJobRun.update({
    where: { id: runId },
    data: {
      finishedAt: new Date(),
      ok: result.ok,
      meta: result.meta ?? Prisma.JsonNull,
      // Free the production slot; leave smoke/explicit tokens unique for overlap tests.
      ...(releaseInflight ? { claimedToken: `${runId}:done` } : {}),
    },
  });
}
