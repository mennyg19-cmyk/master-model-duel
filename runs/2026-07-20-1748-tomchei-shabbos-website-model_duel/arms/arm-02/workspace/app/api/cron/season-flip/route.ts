import { db } from "@/lib/db";
import { requireCronAuth, runCronJob } from "@/lib/cron";
import { writeAudit } from "@/lib/audit";

/**
 * Scheduled season auto-flip (UR-008, R-182). Schedules are one-shot: a fired
 * opensAt/closesAt is cleared so the cron can't re-fight a manager who flips
 * the switch by hand afterwards — reads still trust `status` alone.
 * Closes run before opens so a back-to-back handover lands on the new season.
 */
export async function POST(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const result = await runCronJob("season-flip", async () => {
    const now = new Date();
    const closed: string[] = [];
    const opened: string[] = [];

    await db.$transaction(async (tx) => {
      const dueToClose = await tx.season.findMany({
        where: { status: "OPEN", closesAt: { lte: now } },
      });
      for (const season of dueToClose) {
        await tx.season.update({
          where: { id: season.id },
          data: { status: "CLOSED", closesAt: null },
        });
        await writeAudit(
          null,
          { action: "season.autoflip.close", targetType: "Season", targetId: season.id, detail: { name: season.name } },
          tx
        );
        closed.push(season.name);
      }

      // Newest schedule wins if several are overdue; the rest just get their
      // stale schedules cleared instead of opening and immediately losing.
      const dueToOpen = await tx.season.findMany({
        where: { status: "CLOSED", opensAt: { lte: now } },
        orderBy: { opensAt: "desc" },
      });
      for (const [index, season] of dueToOpen.entries()) {
        if (index === 0) {
          await tx.season.updateMany({
            where: { status: "OPEN", id: { not: season.id } },
            data: { status: "CLOSED" },
          });
          await tx.season.update({
            where: { id: season.id },
            data: { status: "OPEN", opensAt: null },
          });
          await writeAudit(
            null,
            { action: "season.autoflip.open", targetType: "Season", targetId: season.id, detail: { name: season.name } },
            tx
          );
          opened.push(season.name);
        } else {
          await tx.season.update({ where: { id: season.id }, data: { opensAt: null } });
        }
      }
    });

    return { opened, closed };
  });

  return Response.json({ ok: true, ...result });
}
