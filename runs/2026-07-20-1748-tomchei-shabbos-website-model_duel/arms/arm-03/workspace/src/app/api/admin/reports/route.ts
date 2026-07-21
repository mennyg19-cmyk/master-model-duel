import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { marginReport, performanceReport } from "@/lib/ops/reports";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") ?? "performance";
    const seasonId = url.searchParams.get("seasonId");

    if (kind === "margin") {
      await requirePermission("settings.write");
      const report = await marginReport({
        seasonId: seasonId ?? undefined,
      });
      return NextResponse.json({ ok: true, kind: "margin", report });
    }

    await requirePermission("admin.access");
    const seasons = await performanceReport(
      seasonId ? { seasonIds: [seasonId] } : undefined,
    );
    const totals = {
      orderCount: seasons.reduce((s, r) => s + r.orderCount, 0),
      paidOrderCount: seasons.reduce((s, r) => s + r.paidOrderCount, 0),
      packageCount: seasons.reduce((s, r) => s + r.packageCount, 0),
      revenueCents: seasons.reduce((s, r) => s + r.revenueCents, 0),
    };
    return NextResponse.json({
      ok: true,
      kind: "performance",
      seasons,
      totals,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
