import { prisma } from "@/lib/db";

export async function autoOpenScheduledSeasons(now = new Date()) {
  const startedAt = new Date();
  const scheduledSeasons = await prisma.season.findMany({
    where: {
      status: "CLOSED",
      opensAt: { lte: now },
      OR: [{ closesAt: null }, { closesAt: { gt: now } }],
    },
    select: { id: true },
  });
  const opened = await prisma.season.updateMany({
    where: {
      id: { in: scheduledSeasons.map((season) => season.id) },
      status: "CLOSED",
      opensAt: { lte: now },
      OR: [{ closesAt: null }, { closesAt: { gt: now } }],
    },
    data: { status: "OPEN" },
  });
  await prisma.cronRunLog.create({
    data: {
      jobName: "season-auto-flip",
      startedAt,
      completedAt: new Date(),
      outcome: "ok",
      details: { opened: opened.count, openedSeasonIds: scheduledSeasons.map((season) => season.id) },
    },
  });
  return opened.count;
}
