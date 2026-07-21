import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { dashboardKpis, todayWorkQueue } from "@/lib/ops/orders";
import { getSetting } from "@/lib/settings";
import { OPS_SETTINGS, type AlertBannerSetting } from "@/lib/ops/settings-keys";

export async function GET() {
  try {
    await requirePermission("admin.access");
    const [kpis, today, banner] = await Promise.all([
      dashboardKpis(),
      todayWorkQueue(40),
      getSetting<AlertBannerSetting>(OPS_SETTINGS.alertBanner),
    ]);
    return NextResponse.json({ ok: true, kpis, today, banner });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
