import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse, ApiError } from "@/lib/api-error";
import { getCurrentSeason } from "@/lib/storefront/season";
import { scheduleBulkDelivery } from "@/lib/pickup/bulk";

const bodySchema = z.object({
  packageIds: z.array(z.string().min(1)).min(1),
  deliveryDate: z.string().min(1),
  windowLabel: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const body = bodySchema.parse(await request.json());
    const deliveryDate = new Date(body.deliveryDate);
    if (Number.isNaN(deliveryDate.getTime())) {
      throw new ApiError("Invalid deliveryDate", 400);
    }
    const result = await scheduleBulkDelivery({
      seasonId: season.id,
      packageIds: body.packageIds,
      deliveryDate,
      windowLabel: body.windowLabel,
      actorId: staff.effectiveStaff.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
