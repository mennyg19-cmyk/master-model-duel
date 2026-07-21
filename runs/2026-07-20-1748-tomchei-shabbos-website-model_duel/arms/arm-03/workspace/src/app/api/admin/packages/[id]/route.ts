import { NextResponse } from "next/server";
import { PackageStage } from "@prisma/client";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getCurrentSeason } from "@/lib/storefront/season";
import { getPackageDetail, splitPackage } from "@/lib/ops/packages";
import { transitionPackage } from "@/lib/orders/package-stages";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const { id } = await ctx.params;
    const pkg = await getPackageDetail(season.id, id);
    if (!pkg) {
      return NextResponse.json({ ok: false, error: "Package not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, package: pkg });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("split"),
    itemIds: z.array(z.string().min(1)).min(1),
    expectedVersion: z.number().int().nonnegative().optional(),
  }),
  z.object({
    action: z.literal("stage"),
    toStage: z.nativeEnum(PackageStage),
    expectedVersion: z.number().int().nonnegative().optional(),
  }),
]);

export async function POST(request: Request, ctx: Ctx) {
  try {
    const staff = await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const { id } = await ctx.params;
    const body = bodySchema.parse(await request.json());

    if (body.action === "split") {
      const result = await splitPackage({
        seasonId: season.id,
        packageId: id,
        itemIds: body.itemIds,
        actorId: staff.effectiveStaff.id,
        expectedVersion: body.expectedVersion,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      return NextResponse.json({ ok: true, ...result.value });
    }

    const result = await transitionPackage(
      season.id,
      id,
      body.toStage,
      staff.effectiveStaff.id,
      body.expectedVersion,
    );
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, package: result.value.package });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
