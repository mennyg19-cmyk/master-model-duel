import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getCurrentSeason } from "@/lib/storefront/season";
import {
  doorList,
  markPickupReadyIfEligible,
  stampPickedUp,
  unclaimedPickupReport,
} from "@/lib/pickup/service";
import { followUpQueue } from "@/lib/pickup/bulk";

export async function GET(request: Request) {
  try {
    await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "door";
    if (view === "unclaimed") {
      const rows = await unclaimedPickupReport(season.id);
      return NextResponse.json({ ok: true, unclaimed: rows });
    }
    if (view === "follow-up") {
      const filter = (url.searchParams.get("filter") ?? "all") as
        | "unpaid"
        | "unclaimed_pickup"
        | "bulk_pending"
        | "all";
      const queue = await followUpQueue({ seasonId: season.id, filter });
      return NextResponse.json({ ok: true, ...queue });
    }
    const rows = await doorList(season.id);
    return NextResponse.json({ ok: true, doorList: rows });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ready"), packageId: z.string().min(1) }),
  z.object({ action: z.literal("stamp"), packageId: z.string().min(1) }),
]);

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const body = bodySchema.parse(await request.json());
    if (body.action === "ready") {
      const result = await markPickupReadyIfEligible({
        seasonId: season.id,
        packageId: body.packageId,
        actorId: staff.effectiveStaff.id,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    const stamped = await stampPickedUp({
      seasonId: season.id,
      packageId: body.packageId,
      actorId: staff.effectiveStaff.id,
    });
    return NextResponse.json({ ok: true, package: stamped });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
