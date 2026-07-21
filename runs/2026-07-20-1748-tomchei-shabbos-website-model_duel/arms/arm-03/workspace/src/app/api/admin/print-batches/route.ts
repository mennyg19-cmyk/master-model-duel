import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getCurrentSeason } from "@/lib/storefront/season";
import {
  listPrintBatches,
  reprintFilingGroup,
  reprintOrder,
  runNightlyPrintBatch,
} from "@/lib/ops/print-batch";

const batchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("nightly"),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    action: z.literal("reprint-group"),
    filingGroup: z.string().trim().min(1).max(80),
  }),
  z.object({
    action: z.literal("reprint-order"),
    orderId: z.string().min(1),
  }),
]);

export async function GET(request: Request) {
  try {
    await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "20");
    const batches = await listPrintBatches(season.id, limit);
    return NextResponse.json({ ok: true, batches });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("admin.access");
    const parsed = batchSchema.parse(await request.json());
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const actorId = staff.effectiveStaff.id;
    // Always current season — client-supplied seasonId rejected (no archived-season override).
    const seasonId = season.id;

    if (parsed.action === "nightly") {
      const result = await runNightlyPrintBatch({
        seasonId,
        actorId,
        day: parsed.day,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      return NextResponse.json({ ok: true, ...result.value });
    }

    if (parsed.action === "reprint-group") {
      const result = await reprintFilingGroup({
        seasonId,
        filingGroup: parsed.filingGroup,
        actorId,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      return NextResponse.json({ ok: true, ...result.value });
    }

    const result = await reprintOrder({
      seasonId,
      orderId: parsed.orderId,
      actorId,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
