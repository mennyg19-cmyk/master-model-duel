import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { mapDomainError } from "@/lib/http-errors";
import { parseBody } from "@/lib/parse-body";
import { countUnscheduledBulkPackages, listBulkSchedules, scheduleBulkDelivery } from "@/lib/bulk/schedule";
import { getOpenSeason } from "@/lib/seasons/queries";

export const dynamic = "force-dynamic";

const scheduleSchema = z.object({
  deliveryDay: z.string().min(1),
  window: z.string().min(1).optional(),
});

// G-021/R-079: bulk delivery scheduling. POST snapshots every unscheduled
// bulk package into one schedule and sends exactly one email + one SMS per
// DISTINCT customer; GET lists past schedules plus the pending count.
export async function GET() {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const season = await getOpenSeason();
  if (!season) return NextResponse.json({ error: "No open season" }, { status: 422 });

  const [schedules, pendingCount] = await Promise.all([listBulkSchedules(season.id), countUnscheduledBulkPackages(season.id)]);
  return NextResponse.json({ ok: true, schedules, pendingCount });
}

export async function POST(request: Request) {
  const gate = await requireApiPermission("fulfillment.manage");
  if (!gate.ok) return gate.response;
  const parsed = await parseBody(request, scheduleSchema, "A delivery day is required");
  if (!parsed.ok) return parsed.response;

  try {
    const result = await scheduleBulkDelivery({ ...parsed.data, ctx: gate.ctx });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
