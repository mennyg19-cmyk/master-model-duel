import { Season, SeasonStatus } from "@prisma/client";
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

export interface SeasonManagerRow {
  id: string;
  name: string;
  status: SeasonStatus;
  scheduledOpensAt: Date | null;
  scheduledClosesAt: Date | null;
  productCount: number;
  orderCount: number;
}

/** Admin seasons page rows, newest first — the manager serializes Date → ISO at the boundary. */
export async function listSeasonManagerRows(): Promise<SeasonManagerRow[]> {
  const seasons = await prisma.season.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { products: true, orders: true } } },
  });
  return seasons.map((season) => ({
    id: season.id,
    name: season.name,
    status: season.status,
    scheduledOpensAt: season.scheduledOpensAt,
    scheduledClosesAt: season.scheduledClosesAt,
    productCount: season._count.products,
    orderCount: season._count.orders,
  }));
}
