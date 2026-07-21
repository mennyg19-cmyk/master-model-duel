import { NextResponse } from "next/server";
import { PackageStage } from "@prisma/client";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getCurrentSeason } from "@/lib/storefront/season";
import {
  bulkAdvancePackageStage,
  listPackages,
  regroupPackages,
} from "@/lib/ops/packages";

export async function GET(request: Request) {
  try {
    await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const url = new URL(request.url);
    const stageRaw = url.searchParams.get("stage");
    const stage =
      stageRaw && Object.values(PackageStage).includes(stageRaw as PackageStage)
        ? (stageRaw as PackageStage)
        : undefined;
    const result = await listPackages({
      seasonId: season.id,
      q: url.searchParams.get("q") ?? undefined,
      stage,
      fulfillmentMethodCode: url.searchParams.get("method") ?? undefined,
      orderId: url.searchParams.get("orderId") ?? undefined,
      page: Number(url.searchParams.get("page") ?? "1"),
      pageSize: Number(url.searchParams.get("pageSize") ?? "50"),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("stage"),
    toStage: z.nativeEnum(PackageStage),
    items: z
      .array(
        z.object({
          packageId: z.string().min(1),
          expectedVersion: z.number().int().nonnegative().optional(),
        }),
      )
      .min(1)
      .max(200),
  }),
  z.object({
    action: z.literal("regroup"),
    packageIds: z.array(z.string().min(1)).min(2).max(20),
  }),
]);

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const body = postSchema.parse(await request.json());

    if (body.action === "regroup") {
      const result = await regroupPackages({
        seasonId: season.id,
        packageIds: body.packageIds,
        actorId: staff.effectiveStaff.id,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      return NextResponse.json({ ok: true, ...result.value });
    }

    const result = await bulkAdvancePackageStage({
      seasonId: season.id,
      items: body.items,
      toStage: body.toStage,
      actorId: staff.effectiveStaff.id,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
