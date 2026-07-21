import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api-error";
import { getCurrentSeason } from "@/lib/storefront/season";
import {
  confirmReroute,
  getRouteDetail,
  issueMagicLink,
  markStopDeliveredFromPrint,
  printRoute,
  reassignRoute,
  suggestReroutes,
} from "@/lib/routes/service";
import { switchFulfillmentMethod } from "@/lib/routes/method-switch";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requirePermission("admin.access");
    const season = await getCurrentSeason();
    if (!season) {
      return NextResponse.json({ ok: false, error: "No season" }, { status: 409 });
    }
    const { id } = await ctx.params;
    const route = await getRouteDetail(season.id, id);
    if (!route) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, route });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reassign"),
    driverStaffId: z.string().min(1).nullable(),
    pin: z.string().regex(/^\d{4}$/).optional().nullable(),
  }),
  z.object({ action: z.literal("magic-link") }),
  z.object({ action: z.literal("print") }),
  z.object({ action: z.literal("suggest-reroute") }),
  z.object({
    action: z.literal("confirm-reroute"),
    packageId: z.string().min(1),
    confirm: z.boolean(),
  }),
  z.object({
    action: z.literal("switch-method"),
    packageId: z.string().min(1),
    toMethodCode: z.string().min(1),
  }),
  z.object({
    action: z.literal("print-deliver"),
    stopId: z.string().min(1),
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

    if (body.action === "reassign") {
      const route = await reassignRoute({
        seasonId: season.id,
        routeId: id,
        driverStaffId: body.driverStaffId,
        pin: body.pin ?? null,
        actorId: staff.effectiveStaff.id,
      });
      return NextResponse.json({ ok: true, route });
    }

    if (body.action === "magic-link") {
      const link = await issueMagicLink({
        seasonId: season.id,
        routeId: id,
        actorId: staff.effectiveStaff.id,
      });
      return NextResponse.json({ ok: true, ...link });
    }

    if (body.action === "print") {
      const printed = await printRoute({ seasonId: season.id, routeId: id });
      return NextResponse.json({
        ok: true,
        printText: printed.printText,
        payload: printed.payload,
        greetingPdfBase64: printed.greetingPdf.toString("base64"),
      });
    }

    if (body.action === "suggest-reroute") {
      const suggestions = await suggestReroutes({
        seasonId: season.id,
        routeId: id,
      });
      return NextResponse.json({ ok: true, suggestions });
    }

    if (body.action === "confirm-reroute") {
      const stop = await confirmReroute({
        seasonId: season.id,
        routeId: id,
        packageId: body.packageId,
        confirm: body.confirm,
        actorId: staff.effectiveStaff.id,
      });
      return NextResponse.json({ ok: true, stop });
    }

    if (body.action === "print-deliver") {
      const result = await markStopDeliveredFromPrint({
        seasonId: season.id,
        routeId: id,
        stopId: body.stopId,
        actorId: staff.effectiveStaff.id,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const switched = await switchFulfillmentMethod({
      seasonId: season.id,
      packageId: body.packageId,
      toMethodCode: body.toMethodCode,
      actorId: staff.effectiveStaff.id,
    });
    return NextResponse.json({ ok: true, ...switched });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
