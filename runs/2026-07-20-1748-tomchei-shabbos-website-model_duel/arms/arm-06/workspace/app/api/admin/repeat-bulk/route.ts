import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { BULK_ACTION_LIMIT } from "@/lib/orders/bulk";
import { listBulkHistoryCandidates, runBulkHistory } from "@/lib/repeat/bulk-history";

export const dynamic = "force-dynamic";

// P10 (R-058): bulk repeat of customer HISTORY — prior-season finalized
// orders repeated into the open season. GET feeds the picker page; POST runs
// the bounded batch (idempotent: already-repeated orders are skipped rows).
export async function GET(request: Request) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const sourceSeasonId = url.searchParams.get("seasonId") ?? undefined;
  try {
    const result = await listBulkHistoryCandidates({ sourceSeasonId });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}

const runSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(BULK_ACTION_LIMIT),
});

export async function POST(request: Request) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, runSchema, "Order ids are required");
  if (!parsed.ok) return parsed.response;

  try {
    const report = await runBulkHistory({ orderIds: parsed.data.orderIds, ctx: gate.ctx });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
