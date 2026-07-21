import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getCurrentSeason } from "@/lib/storefront/season";
import {
  createRouteFromPackages,
  listRoutes,
} from "@/lib/routes/service";

export async function GET() {
  try {
    await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const routes = await listRoutes(season.id);
    return NextResponse.json({ ok: true, routes });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const createSchema = z.object({
  name: z.string().min(1),
  packageIds: z.array(z.string().min(1)).min(1),
  driverStaffId: z.string().min(1).optional().nullable(),
  pin: z.string().regex(/^\d{4}$/).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const body = createSchema.parse(await request.json());
    const route = await createRouteFromPackages({
      seasonId: season.id,
      name: body.name,
      packageIds: body.packageIds,
      driverStaffId: body.driverStaffId ?? null,
      pin: body.pin ?? null,
      actorId: staff.effectiveStaff.id,
    });
    return NextResponse.json({ ok: true, route });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
