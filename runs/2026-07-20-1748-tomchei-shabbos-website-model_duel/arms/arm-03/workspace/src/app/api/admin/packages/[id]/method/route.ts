import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getCurrentSeason } from "@/lib/storefront/season";
import { switchFulfillmentMethod } from "@/lib/routes/method-switch";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  toMethodCode: z.string().min(1),
});

export async function POST(request: Request, ctx: Ctx) {
  try {
    const staff = await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const { id } = await ctx.params;
    const body = bodySchema.parse(await request.json());
    const result = await switchFulfillmentMethod({
      seasonId: season.id,
      packageId: id,
      toMethodCode: body.toMethodCode,
      actorId: staff.effectiveStaff.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
