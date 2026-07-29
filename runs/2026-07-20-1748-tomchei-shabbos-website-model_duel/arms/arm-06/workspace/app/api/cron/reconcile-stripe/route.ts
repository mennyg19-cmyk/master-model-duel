import { cronRoute } from "@/lib/cron-route";
import { runReconciliation } from "@/lib/reconcile/matcher";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// R-093/R-163: unattended daily reconciliation — same matcher as the run
// button, CronRun row for the audit trail (R-163).
export const GET = cronRoute(async () => {
  const cron = await prisma.cronRun.create({ data: { name: "reconcile-stripe" } });
  try {
    const result = await runReconciliation({});
    await prisma.cronRun.update({
      where: { id: cron.id },
      data: {
        status: "OK",
        finishedAt: new Date(),
        message: `checked=${result.run.checkedCount} matched=${result.run.matchedCount} flagged=${result.run.flaggedCount}`,
      },
    });
    return {
      runId: result.run.id,
      checked: result.run.checkedCount,
      matched: result.run.matchedCount,
      flagged: result.run.flaggedCount,
    };
  } catch (error) {
    await prisma.cronRun.update({
      where: { id: cron.id },
      data: { status: "FAILED", finishedAt: new Date(), message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
});
