import { Season } from "@prisma/client";
import { prisma } from "@/lib/db";

// The single open season gates all selling (UR-008); uniqueness is enforced by
// the "seasons_single_open" partial index. Auto-flip schedule lives on the
// row; the flip job lands with the cron phase and logs to CronRun.
export async function getOpenSeason(): Promise<Season | null> {
  return prisma.season.findFirst({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
  });
}
