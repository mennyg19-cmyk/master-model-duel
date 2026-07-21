import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getCurrentSeason } from "@/lib/storefront/season";
import { fulfillmentChannelDashboard } from "@/lib/ops/packages";

export async function GET() {
  try {
    await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const dashboard = await fulfillmentChannelDashboard(season.id);
    return NextResponse.json({ ok: true, ...dashboard });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
